// Minimal, dependency-light migration runner. Deliberately not node-pg-migrate or an
// ORM's migration tool — see the comment in 0001_extensions_and_migrations_table.sql
// for why plain, ordered SQL files are the right choice for this schema's append-only
// and RLS patterns. Swap this for a more featureful tool later if the team wants one;
// nothing else in the codebase depends on how migrations are run, only on the schema
// they produce.
//
// Usage: ts-node db/migrate.ts up
//
// Connects as the migration-owner role (DATABASE_URL), NOT thriski_app — running
// migrations, including the RLS/role-creation migration, requires elevated privileges
// that the runtime application role must not have.

import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function main() {
  const direction = process.argv[2];
  if (direction !== 'up') {
    console.error('Only "up" is implemented — this schema has no rollback migrations.');
    console.error('Section 20.3\'s append-only tables make "down" migrations mostly');
    console.error('meaningless once real data exists; fix forward with a new migration instead.');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set — copy .env.example to .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const applied = new Set(
      (await client.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort(); // filenames are zero-padded and numbered, so lexical sort == intended order

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`Applying ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }

    console.log('Migrations up to date.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
