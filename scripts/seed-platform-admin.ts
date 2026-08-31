/**
 * The only way a platform administrator gets created in Release 1. Deliberately not
 * an HTTP endpoint — see identity.module.ts and migration 0013's
 * platform_administrators_write policy — run this manually, out of band, by whoever
 * has shell access to the environment. Same precedent as scripts/demo-tenancy.ts:
 * calls repository functions directly rather than going over HTTP.
 *
 * Run with: npm run seed:platform-admin -- <email> <password>
 */
import { withAuthorizationContext } from '../src/db/authorization-context';
import { pool } from '../src/db/pool';

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run seed:platform-admin -- <email> <password>');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  // hashPassword isn't exported from identity.repository.ts (only verifyPassword is,
  // for other modules that never need to construct a hash themselves) — this script is
  // the one legitimate exception, so it duplicates the same scrypt call rather than
  // widening that module's public surface for a single one-off caller.
  const { randomBytes, scryptSync } = await import('crypto');
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  const passwordHash = `${salt.toString('hex')}:${derived.toString('hex')}`;

  const id = await withAuthorizationContext({ actorType: 'system' }, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO platform_administrators (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [email.toLowerCase(), passwordHash],
    );
    return rows[0].id as string;
  });

  console.log(`Platform administrator created: ${email} (${id})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
