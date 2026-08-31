-- Follow-up to 0015, discovered by association-memberships-rls.spec.ts failing with
-- "permission denied for table association_memberships" rather than an RLS rejection:
-- 0007's blanket `GRANT SELECT, INSERT, UPDATE` never included DELETE for ANY table,
-- including this one. 0015's new DELETE policy was correct but inert without the
-- underlying table-level grant — RLS only narrows what a GRANT already permits, it
-- can't grant a command back.
--
-- This is NOT the same situation as evidence/check_result/audit_log/metering_event,
-- which 0007's comment deliberately keeps DELETE-less schema-wide for append-only
-- integrity. association_memberships is ordinary draft-editable domain data (ONB-008),
-- not one of those four tables — granting DELETE here, scoped by 0015's ownership-only
-- policy, is the intended exception, not an oversight to silently extend elsewhere.
-- Following this repo's own precedent (0008 fixed a gap in 0007 via a new migration,
-- not an edit to 0007) rather than editing 0015 after the fact.

GRANT DELETE ON association_memberships TO thriski_app;
