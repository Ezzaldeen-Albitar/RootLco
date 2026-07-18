#!/usr/bin/env node
/**
 * Generic, operator-directed organization provisioning runner.
 *
 * The package owns all organization data. This runner contains no customer
 * facts or credentials and refuses every environment except the two explicit
 * pilot-operation gates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const ALLOWED_ENVIRONMENTS = new Set(['local-pilot', 'production-pilot']);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const parsed = { packagePath: undefined, confirm: undefined, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--package') {
      parsed.packagePath = argv[++index];
      if (!parsed.packagePath) fail('--package requires a path');
    } else if (arg === '--confirm') {
      parsed.confirm = argv[++index];
      if (!parsed.confirm) fail('--confirm requires a tenant code');
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  if (!parsed.packagePath) fail('Missing required --package <path>');
  if (!parsed.confirm) fail('Missing required --confirm <tenant-code>');
  return parsed;
}

function readPackage(packagePath) {
  let value;
  try {
    value = JSON.parse(readFileSync(resolve(packagePath), 'utf8'));
  } catch (error) {
    fail(`Cannot read provisioning package: ${error.message}`);
  }
  if (!value || typeof value !== 'object') fail('Provisioning package must be a JSON object');
  if (!value.plan || typeof value.plan !== 'object') fail('Package is missing plan');
  if (!value.provisioning || typeof value.provisioning !== 'object') {
    fail('Package is missing provisioning');
  }
  if (!value.provisioning.tenant?.code) fail('Package is missing provisioning.tenant.code');
  if (!value.idempotency_key || typeof value.idempotency_key !== 'string') {
    fail('Package is missing idempotency_key');
  }
  const requiredPlanFields = [
    'plan_code',
    'name',
    'description',
    'entitlement_document',
    'capacity_limits',
    'status',
    'effective_from',
    'created_by',
  ];
  for (const field of requiredPlanFields) {
    if (value.plan[field] === undefined || value.plan[field] === null) {
      fail(`Package plan is missing ${field}`);
    }
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const environment = process.env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail(
      "Fail closed: ROOTLCO_ENV must be exactly 'local-pilot' or 'production-pilot' for provisioning"
    );
  }

  const packageDocument = readPackage(args.packagePath);
  const tenantCode = packageDocument.provisioning.tenant.code;
  if (args.confirm !== tenantCode) {
    fail('--confirm must exactly match provisioning.tenant.code in the package');
  }

  const target = {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
  };
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
    fail('DB_PORT must be a valid TCP port');
  }

  const operation = {
    environment,
    target,
    plan: packageDocument.plan,
    provisioning: packageDocument.provisioning,
    idempotency_key: packageDocument.idempotency_key,
  };
  if (args.dryRun) {
    console.log(JSON.stringify({ dry_run: true, ...operation }, null, 2));
    return;
  }

  const client = new pg.Client({
    ...target,
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
  await client.connect();
  try {
    await client.query('BEGIN');
    const plan = packageDocument.plan;
    await client.query(
      `INSERT INTO org.subscription_plans
         (plan_code, name, description, entitlement_document, capacity_limits,
          status, effective_from, created_by)
       SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::timestamptz, $8::uuid
       WHERE NOT EXISTS (
         SELECT 1 FROM org.subscription_plans WHERE plan_code = $1 AND status = 'active'
       )`,
      [
        plan.plan_code,
        plan.name,
        plan.description,
        JSON.stringify(plan.entitlement_document),
        JSON.stringify(plan.capacity_limits),
        plan.status,
        plan.effective_from,
        plan.created_by,
      ]
    );
    const { rows } = await client.query(
      'SELECT org.provision_organization($1::jsonb, $2) AS provisioning_result',
      [JSON.stringify(packageDocument.provisioning), packageDocument.idempotency_key]
    );
    await client.query('COMMIT');
    console.log(
      JSON.stringify(
        {
          environment,
          target,
          idempotency_key: packageDocument.idempotency_key,
          provisioning_result: rows[0].provisioning_result,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Provisioning failed: ${error.message}`);
  process.exitCode = 1;
});
