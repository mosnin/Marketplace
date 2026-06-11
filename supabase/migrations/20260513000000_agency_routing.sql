-- ============================================================================
-- Agency Lead Auto-Routing: Schema (Phase BP7a)
-- ============================================================================
-- Today the auto-assignment UI at /agency/settings/auto-assignment is a
-- UI-only shell: it offers three assignment methods ('manual',
-- 'round_robin', 'score_based'), but the PATCH target has nowhere to
-- persist the choice. As a result every inbound lead lands in the agency
-- owner's personal space regardless of what the agency picks in settings.
-- This migration gives that setting a home on the Agency row.
--
-- It also adds a single round-robin cursor column (lastAssignedUserId) so
-- the routing engine can distribute leads fairly across provider members
-- over time without having to fan an ordered array of userIds into the
-- database. The engine advances this cursor after each assignment; the
-- next call picks the member immediately after it in the ordered
-- membership list.
-- ============================================================================

-- All columns added via IF NOT EXISTS so replay against an already-migrated
-- DB is a no-op.

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "autoAssignEnabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "assignmentMethod" text NOT NULL DEFAULT 'manual'
    CHECK ("assignmentMethod" IN ('manual', 'round_robin', 'score_based'));

-- Round-robin cursor: the userId picked on the previous assignment.
-- Nullable because no lead has been routed yet on a fresh agency.
-- ON DELETE SET NULL so offboarding the cursor user doesn't cascade-break
-- routing — the engine must treat NULL as "start from the beginning of
-- the ordered member list".
ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "lastAssignedUserId" text
    REFERENCES "User"(id) ON DELETE SET NULL;
