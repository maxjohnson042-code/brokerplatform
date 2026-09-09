# brok3r

Broker onboarding, accreditation and ongoing-monitoring platform. See `CLAUDE.md` for
the compressed orientation, and `docs/` for the full requirements/architecture
document and the Release 1 backlog this scaffold implements the start of.

## What's actually implemented here (Epic 1 of the Release 1 backlog)

- The full module-boundary skeleton from Section 19 (13 modules under `src/modules/*`,
  every one wired into `src/app.module.ts`).
- Schema and migrations for client organisations/users, broker profiles, broker
  businesses and their affiliations, relationships, evidence, the append-only
  `check_result` table, the audit log, and metering events.
- The two-layer tenancy enforcement from Section 20.2: an `AuthorizationContext`
  repository boundary (layer one) plus Postgres row-level security policies (layer
  two), proven against a real database by `scripts/demo-tenancy.ts`.
- A Sumsub provider adapter shape (request signing is real; the HTTP transport is
  stubbed pending sandbox credentials) behind a generic `IdentityVerificationProvider`
  port, per Section 21.
- An architecture test (`test/architecture.spec.ts`) that fails the build if any
  module imports the database driver directly instead of going through
  `withAuthorizationContext`.

**Not implemented yet** — these are later epics in the Release 1 backlog, not bugs:
HTTP controllers/API surface, the broker onboarding forms, business onboarding UI, the
lender review workbench, the ruleset engine, training, notifications. This scaffold
proves the foundation is shaped correctly; it is not a working product yet.

## Setup

Requires Node 20+, Docker (or any local Postgres 16+), and `npm`.

```bash
cp .env.example .env
npm install
npm run db:up          # starts Postgres via docker compose
npm run migrate
npm test                # architecture test
npm run demo:tenancy    # proves tenancy isolation + the temporal check_result pattern
npm run start:dev       # http://localhost:3000/health
```

If you're not using Docker, point `DATABASE_URL` (in `.env`) at any Postgres 16+
instance you control with a superuser-equivalent role — migrations (including the one
that creates the `thriski_app` runtime role, migration 0007) need that. The
**application** itself connects as `thriski_app` (`APP_DATABASE_URL`), which is
deliberately a lower-privileged role — see the comment at the top of
`db/migrations/0007_row_level_security.sql` for why this distinction matters: a
superuser bypasses row-level security regardless of policy, which would make the RLS
layer prove nothing.

## Secrets

`.env` is gitignored. `thriski_app`'s password in migration 0007
(`thriski_app_dev_only`) is a placeholder for local development only — replace the
`CREATE ROLE` statement's password with a value from a real secrets manager before
this runs anywhere but a laptop, and never commit that value.

## Repository layout

```
db/migrations/     numbered, plain-SQL migrations (see db/migrate.ts for why no ORM)
src/db/            the pool singleton and the AuthorizationContext boundary — the
                   only two files in the whole codebase allowed to touch `pg` directly
src/modules/*/     one folder per Section 19 module, each owning its own tables
scripts/           demo-tenancy.ts — run this before trusting any claim about tenancy
                   or temporal storage from the docs alone
test/              architecture.spec.ts
docs/              the master requirements/architecture document and Release 1 backlog
```

## Next steps

Continue from here in Claude Code, working through
`docs/Thriski - Release 1 Backlog.md` starting at Epic 2 (identity/auth HTTP layer and
client-organisation admin tooling) or Epic 3 (broker profile build) — both build
directly on what's here. `CLAUDE.md` is written so a fresh Claude Code session picks
up the non-negotiables without having to re-read the full master document every time,
though it should still do that at least once.
