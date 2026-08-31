-- Epic 3: broker profile build (ONB-003, ONB-005, ONB-012). Additive columns on
-- broker_profiles — no new table, no RLS changes: 0007's broker_profiles_visibility /
-- broker_profiles_self_write policies already cover this table row-for-row, and a
-- nullable column added to an already-covered table needs nothing new from RLS.
--
-- All nullable, required-ness enforced at the application layer (see
-- brokers.repository.ts's getOutstandingItems) rather than NOT NULL here — same
-- convention migration 0003 already established for phone_number etc.: a draft profile
-- is allowed to be incomplete, only submit (ONB-008/009) enforces completeness.

-- Section 13.1 personal fields not yet on the table.
ALTER TABLE broker_profiles ADD COLUMN gender TEXT; -- 'male' | 'female' | 'other', validated at the DTO layer
ALTER TABLE broker_profiles ADD COLUMN mobile_number TEXT;
ALTER TABLE broker_profiles ADD COLUMN postal_address JSONB; -- same {line1, line2, city, postcode, state} shape as `address`
ALTER TABLE broker_profiles ADD COLUMN right_to_work_status TEXT;

-- Section 13.3's Epic-3 slice: the broker-declared licensing record. The *system*-
-- populated §13.3 fields (licence status/last verified, chain validity, accreditation
-- dates) are Epic 6/7/10's concern, not this migration's.
ALTER TABLE broker_profiles ADD COLUMN licence_type_held TEXT; -- 'own_credit_licence' | 'credit_representative' | 'exempt'
ALTER TABLE broker_profiles ADD COLUMN credit_licence_number TEXT;
ALTER TABLE broker_profiles ADD COLUMN credit_representative_number TEXT;
ALTER TABLE broker_profiles ADD COLUMN licensing_entity_name TEXT; -- the entity whose licence the broker operates under
ALTER TABLE broker_profiles ADD COLUMN licensing_entity_number TEXT;
