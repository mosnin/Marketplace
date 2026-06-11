-- Agency-level trust signals: optional compliance slots set once by a
-- agency admin and inherited by every linked space's /apply/b/[id] intake.
-- Per-space SpaceSetting values take a back seat to these when the intake
-- is served via the agency variant — agency policy beats per-agent
-- copy for legal text.
--
--   agencyLicenseNumber       — agency-level real-estate license #
--   agencyFairHousingNotice   — multi-line Fair Housing statement
--   agencyShowEqualHousingMark — render the Equal Housing Opportunity logo

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "agencyLicenseNumber" text,
  ADD COLUMN IF NOT EXISTS "agencyFairHousingNotice" text,
  ADD COLUMN IF NOT EXISTS "agencyShowEqualHousingMark" boolean NOT NULL DEFAULT false;
