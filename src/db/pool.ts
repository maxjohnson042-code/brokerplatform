import { Pool } from 'pg';
import { env } from '../config/env';

// The ONLY place in the codebase that is allowed to hold a `pg` Pool. Every module's
// repository imports `withAuthorizationContext` from ./authorization-context, never
// this file directly. test/architecture.spec.ts enforces that — see Section 20.2,
// "enforce with an architecture test that fails the build if a module imports the
// database driver directly."
export const pool = new Pool({ connectionString: env.appDatabaseUrl });
