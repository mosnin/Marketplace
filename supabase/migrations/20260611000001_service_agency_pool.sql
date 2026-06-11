-- Agency service pool.
--
-- Lets a agency own services centrally and assign them down to its member
-- providers (the model chosen for Koala-for-Agencies Phase 2).
--
--   * "agencyId"     — non-null marks a Service as part of a agency pool.
--                         The agency creates it; "spaceId" stays the agency
--                         owner's Space (the pool's home) so the existing NOT
--                         NULL FK on "spaceId" holds without a data backfill.
--   * "assignedSpaceId" — the member provider's Space the service is assigned
--                         to. NULL = unassigned, sitting in the pool. A provider
--                         sees a pool service in their own workspace when
--                         "assignedSpaceId" = their space.
--
-- Additive + idempotent: no existing column is touched, both columns are
-- nullable, and every statement is IF NOT EXISTS. Personal (non-pool)
-- services are unaffected — they keep "agencyId" NULL and behave exactly
-- as before.

ALTER TABLE "Service"
  ADD COLUMN IF NOT EXISTS "agencyId"     TEXT REFERENCES "Agency"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "assignedSpaceId" TEXT REFERENCES "Space"(id)     ON DELETE SET NULL;

-- Pool listing for a agency, newest first.
CREATE INDEX IF NOT EXISTS idx_service_agency
  ON "Service" ("agencyId", "updatedAt" DESC)
  WHERE "agencyId" IS NOT NULL;

-- A provider's assigned pool services.
CREATE INDEX IF NOT EXISTS idx_service_assigned_space
  ON "Service" ("assignedSpaceId")
  WHERE "assignedSpaceId" IS NOT NULL;
