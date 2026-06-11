-- ============================================================================
-- Agency.leadRoutingRule — agency-wide default routing strategy
-- ============================================================================
-- WHY: Today every new unassigned lead waits for a agency to pick a provider
-- by hand at /agency/leads. As agencies grow that doesn't scale — the
-- agency becomes the queue. This column captures the agency's preferred
-- default for auto-routing: keep manual (today's behaviour), round-robin
-- across active members, or fewest-active-load.
--
-- Phase 3 of Koala-for-Agencies ships the set_routing_rule write tool that
-- writes this column. The actual ENFORCEMENT (i.e. when a new lead arrives,
-- auto-pick a provider based on this strategy) is OUT OF SCOPE for Phase 3
-- and will land as a separate change in the lead-creation pipeline. Until
-- that follow-up lands, the column is informational — it captures agency
-- intent so the routing-rule UI and Koala can speak the same language,
-- without changing the existing manual flow.
-- ============================================================================

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "leadRoutingRule" text
    NOT NULL DEFAULT 'manual'
    CHECK ("leadRoutingRule" IN ('manual', 'round_robin', 'fewest_active'));

-- No backfill needed — the DEFAULT clause sets every existing row to
-- 'manual', which matches the current behaviour (agency assigns by hand).
