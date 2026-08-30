import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  // The RUNTIME application connects as thriski_app (see migration 0007) so that
  // row-level security actually constrains it. DATABASE_URL (used by db/migrate.ts)
  // stays privileged and is never read here on purpose — importing this module must
  // never be a way to accidentally get a superuser connection at runtime.
  appDatabaseUrl: required(
    'APP_DATABASE_URL',
    'postgres://thriski_app:thriski_app_dev_only@localhost:5432/thriski',
  ),
  sumsub: {
    appToken: process.env.SUMSUB_APP_TOKEN ?? '',
    secretKey: process.env.SUMSUB_SECRET_KEY ?? '',
    baseUrl: process.env.SUMSUB_BASE_URL ?? 'https://api.sumsub.com',
  },
};
