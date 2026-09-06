# Thriski — context for coding agents

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
- **Epics 1-4 built**: platform foundations, identity/auth (JWT + mandatory client-user
  MFA), broker profile build, broker business onboarding (including the ABN-lookup
  create/search flow below). Epic 5 (documents) is next in sequence.
- ID&V provider: **Sumsub**, both KYC (individual) and KYB (business) — OQ-16
  resolved. Adapter shape is in `src/modules/verification/providers/`; the HTTP call
  itself is stubbed pending sandbox credentials (see that file's comment).
- Business registry lookup (ONB-014/BUS-024): **Australia's ABN Lookup web service**,
  a free self-registered GUID rather than a paid credential — see
  `src/modules/businesses/providers/abn-lookup.provider.ts`. Unlike Sumsub this makes
  a *real* call whenever `ABR_ABN_LOOKUP_GUID` is set (no sandbox tier to wait for);
  degrades to an explicit `not_configured` result, never throws, when it isn't.
- Open dependency: which register/bureau providers cover the non-Sumsub checks in
  Epic 7 (business/company registers, licence and credit-representative currency,
  banned-and-disqualified, adverse records, bankruptcy) is not yet decided.
- Known schema gap, intentionally left visible rather than quietly patched: the
  `relationships` table does not yet have row-level security enabled (see the comment
  in `src/modules/relationships/relationships.repository.ts`). Close this in Epic 8.

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
