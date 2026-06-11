-- Speed-to-lead SLA enforcement.
--
-- Makes lead routing agentic: once a lead is routed to a provider, Koala holds
-- the provider (and the agency) to a first-response clock. These three columns
-- are the per-agency policy the enforcement sweep reads
-- (`lib/agency-sla.ts`, run by `/api/cron/lead-sla`):
--
--   * "slaEnabled"               — off by default; the agency turns it on.
--   * "slaFirstResponseMinutes"  — how long a routed lead may sit un-worked
--                                   before Koala nudges the assigned provider.
--   * "slaEscalateMinutes"       — how long before Koala escalates the
--                                   still-untouched lead to the agency.
--
-- Additive + idempotent: no existing column touched. Detection needs no new
-- schema — a routed lead is the `assigned-by-agency`-tagged Contact clone in
-- the provider's space; "un-worked" = lastContactedAt IS NULL; the clock starts
-- at the clone's createdAt (assignment time).

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "slaEnabled"              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "slaFirstResponseMinutes" integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "slaEscalateMinutes"      integer NOT NULL DEFAULT 120;
