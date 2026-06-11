-- Feature 1: Recurring availability overrides
ALTER TABLE "AppointmentAvailabilityOverride"
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none'
    CHECK (recurrence IN ('none', 'weekly', 'biweekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS "endDate" date;

-- Feature 3: Multi-service scheduling profiles
CREATE TABLE IF NOT EXISTS "AppointmentServiceProfile" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  "appointmentDuration"  integer NOT NULL DEFAULT 30,
  "startHour"     integer NOT NULL DEFAULT 9,
  "endHour"       integer NOT NULL DEFAULT 17,
  "daysAvailable" integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  "bufferMinutes" integer NOT NULL DEFAULT 0,
  "isActive"      boolean NOT NULL DEFAULT true,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_profile_space
  ON "AppointmentServiceProfile" ("spaceId");

-- Link appointments to a specific service profile
ALTER TABLE "Appointment"
  ADD COLUMN IF NOT EXISTS "serviceProfileId" text REFERENCES "AppointmentServiceProfile"(id) ON DELETE SET NULL;

-- Link overrides to a specific service profile
ALTER TABLE "AppointmentAvailabilityOverride"
  ADD COLUMN IF NOT EXISTS "serviceProfileId" text REFERENCES "AppointmentServiceProfile"(id) ON DELETE CASCADE;

ALTER TABLE "AppointmentServiceProfile" ENABLE ROW LEVEL SECURITY;
