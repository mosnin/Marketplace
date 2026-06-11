-- Branding: logo URL and provider profile picture for public pages
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "logoUrl" text,
  ADD COLUMN IF NOT EXISTS "providerPhotoUrl" text;

-- Lead source attribution: track how contacts entered the system
ALTER TABLE "Contact"
  ADD COLUMN IF NOT EXISTS "sourceLabel" text,
  ADD COLUMN IF NOT EXISTS "sourceAppointmentId" text REFERENCES "Appointment"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "followUpAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "lastContactedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "stageChangedAt" timestamptz;

-- Note: sourceLabel, followUpAt, lastContactedAt, stageChangedAt may already exist
-- from previous migrations. The IF NOT EXISTS handles this gracefully.
