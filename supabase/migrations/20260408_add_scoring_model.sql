-- Add AI-generated scoring model columns to SpaceSetting and Agency
-- These store the scoring models separately from the form configs

-- Space-level scoring models (per agent)
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "rentalScoringModel" jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "buyerScoringModel" jsonb DEFAULT NULL;

-- Agency-level scoring models (inherited by members)
ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "agencyRentalScoringModel" jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS "agencyBuyerScoringModel" jsonb DEFAULT NULL;

COMMENT ON COLUMN "SpaceSetting"."rentalScoringModel" IS 'AI-generated scoring model for rental intake form. JSON matches ScoringModel type.';
COMMENT ON COLUMN "SpaceSetting"."buyerScoringModel" IS 'AI-generated scoring model for buyer intake form. JSON matches ScoringModel type.';
COMMENT ON COLUMN "Agency"."agencyRentalScoringModel" IS 'Agency-wide default scoring model for rental forms.';
COMMENT ON COLUMN "Agency"."agencyBuyerScoringModel" IS 'Agency-wide default scoring model for buyer forms.';
