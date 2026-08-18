/**
 * The exclusive lease on the shared RootLco database, and the protocol for it.
 *
 * ## What it is for
 *
 * `shared.claim_outbox_events` is deliberately NOT tenant-scoped: infrastructure
 * dispatch has to be independent of any user tenant session. So a worker started
 * anywhere claims across the WHOLE database, and two harnesses sharing one
 * database are not merely noisy neighbours — one of them will claim, consume and
 * mark `published` the other's events, silently taking ownership of delivery
 * obligations that are not its own.
 *
 * Row locks do not solve it. A lock holds a row that EXISTS; a producer writing
 * one afterwards writes a row nothing is holding. The only honest boundary
 * between concurrent harnesses is a lease that each one takes before it writes.
 *
 * ## The protocol
 *
 * One advisory lock, one key, session-scoped:
 *
 *   1. take it with `pg_try_advisory_lock(DATABASE_LEASE_KEY)` before touching
 *      the database;
 *   2. if it is refused, **REFUSE TO RUN** — do not wait, do not proceed. Waiting
 *      turns a clear failure into a hang, and proceeding is the defect;
 *   3. release it with `pg_advisory_unlock(DATABASE_LEASE_KEY)` at the end, or
 *      simply close the connection, which releases it too.
 *
 * The key lives here rather than in each harness so there is ONE definition of
 * it. A second harness inventing its own number takes a lease nobody else
 * respects, which is indistinguishable from taking no lease at all.
 *
 * ## What it does not promise
 *
 * A lease binds those who speak the protocol. Something that writes without
 * taking it — a running application server, a person with `psql` — is not
 * excluded by anything here, which is why the backend outbox suite ALSO checks
 * for rows that arrived outside its own snapshot and aborts before claiming.
 * Detection is the backstop; the lease is the boundary. Neither is a claim that
 * a stranger cannot write, because nothing this side of an isolated database
 * could make that claim honestly.
 */

/** The advisory-lock key. Arbitrary, fixed, and shared by every harness. */
export const DATABASE_LEASE_KEY = 917_281_305;

/**
 * Takes the lease on an already-connected `pg` client, or throws.
 *
 * Takes a client rather than making one: a lease is SESSION-scoped, so it lives
 * exactly as long as the connection that holds it, and a helper that opened its
 * own connection would drop the lease the moment it returned.
 */
export async function acquireDatabaseLease(client, harnessName) {
  const held = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [
    DATABASE_LEASE_KEY,
  ]);
  if (held.rows[0]?.locked !== true) {
    throw new Error(
      `REFUSING TO RUN (${harnessName}): another harness holds the RootLco shared-database ` +
        `lease (advisory key ${DATABASE_LEASE_KEY}). Work that claims from the shared outbox ` +
        'claims across EVERY tenant, so running beside another writer means publishing events ' +
        'that are not yours. Stop the other harness, or use an isolated database.'
    );
  }
}

/** Releases the lease. Closing the connection releases it too. */
export async function releaseDatabaseLease(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [DATABASE_LEASE_KEY]);
}
