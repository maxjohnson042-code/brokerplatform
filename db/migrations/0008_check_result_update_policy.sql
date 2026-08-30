-- Fixes a real gap found by running scripts/demo-tenancy.ts against this schema, not
-- a hypothetical one: migration 0007 gave check_result a SELECT and an INSERT policy
-- but no UPDATE policy. With ROW LEVEL SECURITY FORCEd and no applicable policy for a
-- command, Postgres denies that command for every row — silently, with no error,
-- just zero rows affected. recordCheckResult()'s supersede step
-- (`UPDATE check_result SET valid_to = now(), superseded_by = $1 WHERE id = $2`) was
-- therefore updating nothing, and the append-only pattern in Section 20.3 was not
-- actually being enforced despite the application code looking correct.
--
-- This is exactly the kind of mistake Section 20.2's "belt and braces" is meant to
-- surface early rather than in production — it did.

CREATE POLICY check_result_close_out ON check_result
  FOR UPDATE
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin'))
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));
