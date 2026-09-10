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
    // Levels are configured per-account in Sumsub's own dashboard, not a fixed string
    // — this default is almost certainly wrong for any real account and exists only
    // so the adapter has something to call before it's set. Same reasoning for the
    // webhook secret: Sumsub lets you configure a separate secret per webhook
    // subscription, which may or may not be the same as SUMSUB_SECRET_KEY above.
    kycLevelName: process.env.SUMSUB_KYC_LEVEL_NAME ?? 'basic-kyc-level',
    // `||` not `??`: an .env file that declares the key but leaves it blank (as
    // .env.example documents) sets process.env to '', which `??` would NOT fall
    // through on (it only treats null/undefined as absent) — silently defeating the
    // documented "leave blank to reuse SUMSUB_SECRET_KEY" behaviour.
    webhookSecret: process.env.SUMSUB_WEBHOOK_SECRET || process.env.SUMSUB_SECRET_KEY || '',
    // Sumsub lets the account owner pick the digest algorithm per webhook
    // subscription in their dashboard — this must match whatever's actually
    // configured there, not guessed.
    webhookDigestAlg: process.env.SUMSUB_WEBHOOK_DIGEST_ALG ?? 'sha256',
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
    fromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'no-reply@brok3r.local',
  },
  // ONB-014/BUS-024 (Section 6.1a, OQ-45): Australia's ABN Lookup web service —
  // free, public, a self-registered GUID rather than a paid/negotiated credential
  // (see https://abr.business.gov.au/Tools/WebServices). Unlike Sumsub, there is no
  // sandbox-vs-production distinction to stub around — src/modules/businesses/
  // providers/abn-lookup.provider.ts makes a real call whenever this is set, and
  // returns an explicit "not configured" result (never throws) when it isn't, so the
  // manual-entry fallback always works either way.
  abrAbnLookup: {
    guid: process.env.ABR_ABN_LOOKUP_GUID ?? '',
  },
};
