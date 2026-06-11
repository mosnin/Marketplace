-- Waitlist for fully-booked appointment slots
CREATE TABLE IF NOT EXISTS "AppointmentWaitlist" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "serviceProfileId" text REFERENCES "AppointmentServiceProfile"(id) ON DELETE SET NULL,
  "guestName"     text NOT NULL,
  "guestEmail"    text NOT NULL,
  "guestPhone"    text,
  "preferredDate" date NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'notified', 'booked', 'expired')),
  "notifiedAt"    timestamptz,
  "expiresAt"     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_space_date ON "AppointmentWaitlist" ("spaceId", "preferredDate");
CREATE INDEX IF NOT EXISTS idx_waitlist_status     ON "AppointmentWaitlist" (status);

ALTER TABLE "AppointmentWaitlist" ENABLE ROW LEVEL SECURITY;
