/**
 * Phase 1-10 shared test fixtures (service catalog, pricing, quotation, inventory).
 *
 * All helpers run inside the caller's transaction (context must already be tenant
 * A). They create tenant-scoped rows with a per-call `tag` so committed suites do
 * not collide on unique codes. Quotations originate from a Phase 1-9 work order, so
 * a quotation suite composes seedP109Base + makeAuthorizedVisit + newWorkOrder.
 */
import type { Client } from 'pg';
import { TENANT_A, COMPANY_A1, BRANCH_A1, USER_A } from './helpers';

type Q = { query: Client['query'] };

/**
 * Runs a statement expected to fail with one of `codes`, wrapped in a SAVEPOINT so
 * the surrounding transaction is not left aborted (lets a test mix successful and
 * failing statements freely).
 */
export async function expectFail(
  c: Q,
  codes: string | string[],
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const list = Array.isArray(codes) ? codes : [codes];
  await c.query('SAVEPOINT sp_expect');
  let err: { code?: string; message?: string } | undefined;
  try {
    await c.query(sql, params);
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_expect');
  if (!err) throw new Error(`expected ${list.join('/')} but the statement succeeded`);
  if (!err.code || !list.includes(err.code)) {
    throw new Error(`expected ${list.join('/')} but got ${err.code}: ${err.message}`);
  }
}

const T = TENANT_A;
const CO = COMPANY_A1;
const BR = BRANCH_A1;
const U = USER_A;
/** A second actor id (never USER_A) for maker<>approver segregation. */
export const OTHER_ACTOR = '00000000-0000-4000-8000-0000000000e2';

/** A fresh tenant-A vehicle (unique VIN) so committed work orders never collide on
 *  the one-open-visit-per-vehicle rule. */
export async function seedVehicle(c: Q, tag: string): Promise<string> {
  return (
    await c.query(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1, upper(rpad('P110' || $2, 17, '0')), 'ice', 'active', $3) RETURNING id`,
      [T, tag, U]
    )
  ).rows[0].id;
}

/** Service catalog: tenant category + service + a PUBLISHED v1. */
export async function seedService(
  c: Q,
  tag: string
): Promise<{ category: string; service: string; version: string }> {
  const category = (
    await c.query(
      `INSERT INTO svc.service_categories (tenant_id, code, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [T, `cat_${tag}`, `Category ${tag}`, U]
    )
  ).rows[0].id;
  const service = (
    await c.query(
      `INSERT INTO svc.services (tenant_id, service_category_id, service_code, name, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [T, category, `SVC_${tag}`, `Service ${tag}`, U]
    )
  ).rows[0].id;
  const version = (
    await c.query(
      `INSERT INTO svc.service_versions (tenant_id, service_id, version_no, effective_from, status, created_by)
       VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
      [T, service, U]
    )
  ).rows[0].id;
  await c.query(`SELECT svc.publish_service_version($1,$2,DATE '2026-01-01')`, [service, version]);
  return { category, service, version };
}

/** Pricing: a published price list version with a single tenant-wide rule for a service. */
export async function seedPrice(
  c: Q,
  service: string,
  amount: number,
  tag: string
): Promise<{ priceList: string; version: string; rule: string }> {
  const priceList = (
    await c.query(
      `INSERT INTO svc.price_lists (tenant_id, price_list_code, name, currency_code, created_by) VALUES ($1,$2,$3,'USD',$4) RETURNING id`,
      [T, `PL_${tag}`, `Price list ${tag}`, U]
    )
  ).rows[0].id;
  const version = (
    await c.query(
      `INSERT INTO svc.price_list_versions (tenant_id, price_list_id, version_no, effective_from, status, created_by)
       VALUES ($1,$2,1,DATE '2026-01-01','draft',$3) RETURNING id`,
      [T, priceList, U]
    )
  ).rows[0].id;
  const rule = (
    await c.query(
      `INSERT INTO svc.price_rules (tenant_id, price_list_version_id, service_id, amount, priority, created_by)
       VALUES ($1,$2,$3,$4,0,$5) RETURNING id`,
      [T, version, service, amount, U]
    )
  ).rows[0].id;
  await c.query(`SELECT svc.publish_price_list_version($1,$2,DATE '2026-01-01')`, [
    priceList,
    version,
  ]);
  await c.query(
    `INSERT INTO svc.price_list_assignments (tenant_id, price_list_id, effective_from, created_by)
     VALUES ($1,$2,DATE '2026-01-01',$3)`,
    [T, priceList, U]
  );
  return { priceList, version, rule };
}

/** Inventory item: tenant UoM + item category + item. */
export async function seedItem(
  c: Q,
  tag: string
): Promise<{ uom: string; category: string; item: string }> {
  const uom = (
    await c.query(
      `INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by) VALUES ('tenant',$1,$2,$3,'count',$4) RETURNING id`,
      [T, `u_${tag}`, `Unit ${tag}`, U]
    )
  ).rows[0].id;
  const category = (
    await c.query(
      `INSERT INTO inv.item_categories (tenant_id, code, name, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [T, `ic_${tag}`, `Item cat ${tag}`, U]
    )
  ).rows[0].id;
  const item = (
    await c.query(
      `INSERT INTO inv.item_master (tenant_id, item_category_id, sku, name, uom_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [T, category, `SKU_${tag}`, `Item ${tag}`, uom, U]
    )
  ).rows[0].id;
  return { uom, category, item };
}

/** Warehouse + a child quarantine location. */
export async function seedLocations(
  c: Q,
  tag: string
): Promise<{ warehouse: string; quarantine: string }> {
  const warehouse = (
    await c.query(
      `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
       VALUES ($1,$2,$3,$4,$5,'warehouse',$6) RETURNING id`,
      [T, CO, BR, `wh_${tag}`, `Warehouse ${tag}`, U]
    )
  ).rows[0].id;
  const quarantine = (
    await c.query(
      `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, parent_location_id, created_by)
       VALUES ($1,$2,$3,$4,$5,'quarantine',$6,$7) RETURNING id`,
      [T, CO, BR, `q_${tag}`, `Quarantine ${tag}`, warehouse, U]
    )
  ).rows[0].id;
  return { warehouse, quarantine };
}

/** Puts `qty` on hand at a location via an approved opening batch (maker<>approver). */
export async function seedStock(
  c: Q,
  item: string,
  location: string,
  qty: number,
  tag: string
): Promise<void> {
  const batch = (
    await c.query(
      `INSERT INTO inv.opening_inventory_batches (tenant_id, company_id, branch_id, batch_code, as_of_date, counted_by, created_by)
       VALUES ($1,$2,$3,$4,DATE '2026-01-01',$5,$6) RETURNING id`,
      [T, CO, BR, `ob_${tag}`, OTHER_ACTOR, U]
    )
  ).rows[0].id;
  await c.query(
    `INSERT INTO inv.opening_inventory_lines (tenant_id, company_id, branch_id, batch_id, item_id, location_id, quantity, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [T, CO, BR, batch, item, location, qty, U]
  );
  await c.query(`SELECT inv.approve_opening_batch($1)`, [batch]);
}

/** A draft quotation for a work order. */
export async function seedQuotation(c: Q, workOrder: string, tag: string): Promise<string> {
  return (
    await c.query(
      `INSERT INTO quo.quotations (tenant_id, company_id, branch_id, work_order_id, quotation_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6) RETURNING id`,
      [T, CO, BR, workOrder, `Q-${tag}`, U]
    )
  ).rows[0].id;
}

/** A draft revision for a quotation. */
export async function draftRevision(c: Q, quotation: string, revNo: number): Promise<string> {
  return (
    await c.query(
      `INSERT INTO quo.quotation_revisions (tenant_id, company_id, branch_id, quotation_id, revision_number, currency_code, created_by)
       VALUES ($1,$2,$3,$4,$5,'USD',$6) RETURNING id`,
      [T, CO, BR, quotation, revNo, U]
    )
  ).rows[0].id;
}

/** Adds a service line to a draft revision (tax + line total computed in SQL to satisfy CHECKs). */
export async function addServiceItem(
  c: Q,
  revision: string,
  service: string,
  line: number,
  unit: number,
  qty: number,
  discount = 0,
  taxRate = 0
): Promise<string> {
  return (
    await c.query(
      `INSERT INTO quo.quotation_items
         (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, service_id,
          currency_code, captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
          captured_tax_amount, captured_line_total, created_by)
       VALUES ($1,$2,$3,$4,$5,'service',$6,'USD',$7,$8,$9,$10,
          round(($7::numeric*$8::numeric - $9::numeric) * $10::numeric, 4),
          round($7::numeric*$8::numeric - $9::numeric + round(($7::numeric*$8::numeric - $9::numeric) * $10::numeric, 4), 4),
          $11) RETURNING id`,
      [T, CO, BR, revision, line, service, unit, qty, discount, taxRate, U]
    )
  ).rows[0].id;
}
