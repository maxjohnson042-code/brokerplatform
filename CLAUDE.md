# brok3r — context for coding agents

This file is what a fresh Claude Code session should read first. It's the compressed
version of `docs/Thriski - Master Requirements and Architecture Document v2.1.md`
(also in this repo — supersedes v2.0, which is kept for history, not current) — read
that document in full before making any architectural decision; this file is a
guardrail, not a substitute for it. Also see `docs/Thriski - Information Architecture
and Onboarding UX.md` for the onboarding-UX assessment behind Section 6.1a and the new
ONB-013–017/BUS-024/IDV-015/DOC-009/REV-013/NFR-PER-3 requirement IDs — all currently
**proposed, not committed** (OQ-45/46/47 track the confirmation decisions).

## What this is

A multi-tenant broker onboarding, accreditation and ongoing-monitoring platform.
Lenders, aggregators and associations (client organisations) each link to a broker's
profile through an explicit, consented relationship and see only what that
relationship entitles them to.

## The six non-negotiables (Section 25) — never skip these to move faster

1. **Metering events** emit on every billable action, even though invoicing is out of
   scope for Release 1. See `src/modules/metering/metering.repository.ts`.
2. **Temporal storage.** Anything a lender might rely on later — check results,
   statuses, decisions — is append-only with `valid_from`/`valid_to`/`superseded_by`.
   Never `UPDATE` a valid row's outcome. See `check_result` in migration 0005 and
   `src/modules/verification/check-result.repository.ts`.
3. **Authorisation context on every read.** Every query touching broker data goes
   through `withAuthorizationContext` (`src/db/authorization-context.ts`). There is no
   other way to get a database connection in this codebase — `test/architecture.spec.ts`
   fails the build if a module imports `pg`'s `Pool`/`Client` or the pool singleton
   directly.
4. **Evidence immutability.** Raw provider payloads go to object storage, write-once,
   content-hashed. See `src/modules/evidence/`.
5. **Audit in the same transaction.** `recordAuditEvent` takes the same `PoolClient` the
   caller already has from `withAuthorizationContext` and writes in the same
   transaction as the domain change — never a separate connection, never "fire and
   forget".
6. **Capture risk-indicator outcome data from day one**, even though the indicator
   itself is Release 4 and gated on a legal/governance framework that doesn't exist
   yet (OQ-27, OQ-41, OQ-42).

## Shape: modular monolith (Section 19)

One deployable NestJS application. Modules under `src/modules/*` each own their
tables and are forbidden from reaching into another module's schema directly. Do not
suggest splitting a module into a separate service unless there's a demonstrated
scaling or team-autonomy problem — the master document is explicit that this was
considered and rejected for now (Section 19), because the domain boundaries are still
moving.

**What not to build** (Section 27, worth re-reading before proposing any of these):
microservices, a rules DSL, Kafka/event streaming, a custom identity provider, push
integration into lender systems, the risk indicator before its gates clear, a generic
document-management system.

## Where things stand

- Release 1 backlog: `docs/Thriski - Release 1 Backlog v2.md` (supersedes the
  original — same epic sequence, each affected epic now cross-references the new
  Section 6.1a requirement IDs). Work through it epic by epic — later epics assume
  earlier ones exist (e.g. accreditation, Epic 10, needs relationships, Epic 8, and the
  ruleset engine, Epic 9, first).
- **Epics 1-6 and 8-13 are built**: platform foundations, identity/auth, broker
  profile build, broker business onboarding, documents/evidence store (Epic 5,
  `src/modules/evidence/`), Sumsub identity verification (Epic 6,
  `src/modules/verification/`), broker-lender relationships (Epic 8,
  `src/modules/relationships/`), the ruleset engine (Epic 9, `src/modules/rulesets/`),
  accreditations and the lender review workbench (Epic 10, `src/modules/accreditation/`),
  training confirmation (Epic 11, `accreditation/training.repository.ts`), notifications
  (Epic 12, `src/modules/notifications/`), and broker self-service/audit surfacing
  (Epic 13, see `getOutstandingSummary`/`listAccessHistory`/`reconstructAsOf` in
  `src/modules/brokers/brokers.repository.ts`). Epic 7 is the one gap in the sequence —
  see below.
- ID&V provider: **Sumsub**, KYC (individual) only — OQ-16 resolved. The adapter
  (`src/modules/verification/providers/sumsub-adapter.ts`) makes a real call: it
  creates an applicant and generates a real hosted WebSDK link (IDV-015). KYB
  (business) is still a mock (`mock-kyb-adapter.ts`) — Sumsub's KYB tier isn't
  provisioned on this account yet.
- Business registry lookup (ONB-014/BUS-024): **Australia's ABN Lookup web service**,
  a free self-registered GUID rather than a paid credential — see
  `src/modules/businesses/providers/abn-lookup.provider.ts`. Unlike Sumsub this makes
  a *real* call whenever `ABR_ABN_LOOKUP_GUID` is set (no sandbox tier to wait for);
  degrades to an explicit `not_configured` result, never throws, when it isn't.
- Open dependency: **Epic 7 hasn't been built.** Which register/bureau providers
  cover the non-Sumsub checks (business/company registers, licence and
  credit-representative currency, banned-and-disqualified, adverse records,
  bankruptcy) is not yet decided — there's no module for it yet.
- The `relationships` table row-level security gap flagged in migration 0007 was
  closed in migration 0021 (Epic 8): `has_active_relationship()` is now the
  SECURITY DEFINER function other tables' policies call into, and RLS is enabled on
  `relationships` itself. Not an open gap any more.

## Running it

```
cp .env.example .env        # then fill in APP_DATABASE_URL, Sumsub keys when you have them
npm run db:up                # postgres via docker compose — or point DATABASE_URL/
                              # APP_DATABASE_URL at any local Postgres 16+
npm run migrate
npm test                     # architecture test
npm run demo:tenancy         # proves the tenancy boundary and the temporal check_result
                              # pattern against a real database — read this script before
                              # trusting either claim from the docs alone
npm run start:dev
```

If `npm run demo:tenancy` doesn't print `ALL PASSED`, treat that as a stop-the-line
signal before building anything else on top — it happened once already during initial
scaffolding (a missing `UPDATE` policy on `check_result`, fixed in migration 0008) and
caught a real gap, not a flaky test.
