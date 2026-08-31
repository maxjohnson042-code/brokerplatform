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
  auth: {
    // Dev-only fallback, same pattern as appDatabaseUrl above — replace from a real
    // secret store before this runs anywhere but a laptop (see README "Secrets").
    jwtSecret: required('JWT_SECRET', 'thriski_jwt_dev_only_do_not_use_in_prod'),
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900), // 15 min
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
    // 32 bytes hex (64 chars), AES-256-GCM key for MFA secret encryption at rest
    // (client_user_mfa_secrets.secret_encrypted). Dev-only fallback — same "swap for a
    // real KMS before production" caveat as hashPassword's scrypt choice.
    mfaEncryptionKey: required(
      'MFA_ENCRYPTION_KEY',
      'eccdcc854960ecb3c5cce5de045afc043f209ac8d7f9671556339a4efa5a8ab1',
    ),
  },
  email: {
    // 'console' (default, degrades gracefully like the Sumsub adapter when
    // unconfigured) or 'resend'. See src/modules/notifications/email-sender.ts.
    provider: process.env.EMAIL_PROVIDER ?? 'console',
    resendApiKey: process.env.RESEND_API_KEY ?? '',
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'no-reply@thriski.local',
  },
};
