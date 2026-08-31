-- Epic 4: broker business onboarding (BUS-001-008, BUS-013). Additive columns, no RLS
-- impact — broker_businesses and business_principals already carry the visibility/write
-- policies this migration's new columns fall under (0007, extended for principals in
-- migration 0019). Section 13.2 fields not yet on the table:

ALTER TABLE broker_businesses ADD COLUMN website TEXT;
ALTER TABLE broker_businesses ADD COLUMN business_email TEXT;
ALTER TABLE broker_businesses ADD COLUMN mailing_address JSONB; -- same shape as `address`, conditional per §13.2

-- §13.2: "Principal(s) name AND EMAIL" — email was missing entirely.
ALTER TABLE business_principals ADD COLUMN email TEXT;

-- Soft-delete, not a hard DELETE: principals are screening subjects (BUS-007's whole
-- emphasis), and this schema's general philosophy is retain-don't-erase (audit_log/
-- evidence/check_result are append-only, relationships uses effective_to instead of
-- deleting). A removed_at filter at the application layer means no new DELETE grant is
-- needed at all, unlike migration 0016's association_memberships fix.
ALTER TABLE business_principals ADD COLUMN removed_at TIMESTAMPTZ;
