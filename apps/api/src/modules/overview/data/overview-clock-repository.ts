/**
 * The local calendar day, measured on the DATABASE clock (Owner directive, D-17).
 *
 * ## Why this reads no table and still belongs in a repository
 *
 * "What day is it in Asia/Amman" is a question only a clock can answer, and the
 * platform has already decided which clock that is: `readSessionState` answers
 * every expiry question in SQL precisely so a timeout cannot depend on the drift
 * between the application server and the database. A dashboard whose "today"
 * came from `new Date()` in the Node process would have the same defect in a
 * more visible place — two branches of the same figure disagreeing about which
 * day a reception belongs to, for a few seconds either side of midnight, and
 * only in the deployment whose clocks happen to have drifted.
 *
 * So the day is read through the same handle, in the same transaction, as every
 * count it will bound. It selects `now()` and nothing else: no table is touched,
 * so this repository owns no schema and crosses no module's wall.
 *
 * The zone is a BIND PARAMETER and never interpolated. It reaches this method
 * from `org.branches.timezone_name`, which `fk_branches_timezone_name`
 * constrains to a `shared.timezones` row, so the only values that can arrive are
 * ones PostgreSQL already validated against its own IANA database.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** The instant the answer was measured, and the calendar day it was there. */
export interface OverviewClockReading {
  /** `YYYY-MM-DD` in the named zone. */
  readonly localDay: string;
  /** The same instant as an ISO-8601 UTC timestamp, for `generatedAt`. */
  readonly asOf: Date;
}

export class OverviewClockRepository extends Repository {
  protected readonly module = 'overview';

  /**
   * The calendar day it currently is in the named zone, and the instant behind it.
   *
   * Both in ONE statement, because they are one fact read two ways: a response
   * whose `generatedAt` came from a second call could name an instant on the
   * other side of the midnight its own period was cut at.
   *
   * `now()` is the TRANSACTION's start instant, not the statement's, which is
   * what makes every figure on one response answer for one moment.
   */
  async reading(db: DbHandle, timezoneName: string): Promise<OverviewClockReading> {
    const row = await this.runOne<{ local_day: string; as_of: Date }>(
      db,
      `SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS local_day,
              now() AS as_of`,
      [timezoneName]
    );
    if (row === null) {
      // Unreachable in practice — the statement has no FROM clause and always
      // produces exactly one row — but failing loudly beats defaulting to a day
      // the caller never asked about.
      throw new Error('overview: the database returned no local day');
    }
    return { localDay: row.local_day, asOf: row.as_of };
  }
}
