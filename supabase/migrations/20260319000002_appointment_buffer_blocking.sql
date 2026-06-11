-- Buffer time between appointments and manual date blocking
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "appointmentBufferMinutes" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "appointmentBlockedDates"  text[] NOT NULL DEFAULT '{}';

-- Track source of deal for appointment→deal conversion analytics
ALTER TABLE "Deal"
  ADD COLUMN IF NOT EXISTS "sourceAppointmentId" text REFERENCES "Appointment"(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deal_source_appointment ON "Deal" ("sourceAppointmentId");
