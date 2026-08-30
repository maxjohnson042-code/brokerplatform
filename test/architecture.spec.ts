import fg from 'fast-glob';
import { readFileSync } from 'fs';

/**
 * Section 20.2: "Layer one, application: every query touching broker data goes
 * through a single repository layer that requires an AuthorisationContext... Enforce
 * with an architecture test that fails the build if a module imports the database
 * driver directly."
 *
 * This is that test. It is deliberately dumb (a regex over source text, not a real
 * TypeScript AST check) — dumb and fast beats thorough and slow for something that
 * runs on every commit, and it is very hard to accidentally write
 * `import { Pool } from 'pg'` in a way this won't catch.
 */
describe('architecture: modules do not touch the database driver directly', () => {
  // Importing the *type* `PoolClient` from 'pg' is fine and expected — audit and
  // metering repositories (and every other repository) receive an already-scoped
  // client as a parameter from withAuthorizationContext and never construct their
  // own. What's forbidden is a module constructing a Pool/Client itself, or reaching
  // for the pool singleton directly instead of going through the authorization
  // context — those are the two ways a query could bypass AuthorisationContext
  // entirely, which is the actual risk Section 20.2 is guarding against.
  const FORBIDDEN_IMPORTS = [
    /import\s*\{[^}]*\bPool\b[^}]*\}\s*from\s*['"]pg['"]/,
    /import\s*\{[^}]*\bClient\b[^}]*\}\s*from\s*['"]pg['"]/,
    /require\(['"]pg['"]\)/,
    /from ['"].*db\/pool['"]/,
  ];

  // src/db/*.ts is the one place allowed to import 'pg' — everything under
  // src/modules/** must go through withAuthorizationContext instead.
  const moduleFiles = fg.sync('src/modules/**/*.ts', { cwd: process.cwd(), absolute: true });

  it('found module files to check (guards against this test silently checking nothing)', () => {
    expect(moduleFiles.length).toBeGreaterThan(0);
  });

  for (const file of moduleFiles) {
    it(`${file.replace(process.cwd(), '.')} does not import the database driver directly`, () => {
      const source = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_IMPORTS) {
        expect(source).not.toMatch(pattern);
      }
    });
  }
});
