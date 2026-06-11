-- Buyer marketplace — the buyer ("services consumer") side of Koala.
--
-- Koala's marketplace lets buyers browse providers (hair stylists, trainers,
-- coaches, photographers, tutors, consultants), then purchase/book a service.
-- A "Purchase" is the buyer-side record of that transaction: who bought, from
-- which provider Space, against which Service / Appointment, and where it is in
-- the fulfilment lifecycle (requested → confirmed → in_progress → delivered →
-- completed, plus a terminal `cancelled`).
--
-- Design decisions (follow DB_CONVENTIONS.md):
--   * PascalCase table, camelCase quoted columns.
--   * `buyerUserId` is the Clerk user id (text) — buyers sign in with the SAME
--     Clerk instance as providers, so this is the buyer's authorization key the
--     way `userId` is on SupportTicket / Attachment. It is NOT a FK to "User":
--     a buyer may transact without ever being provisioned a provider "User"
--     row, so we denormalise `buyerEmail` / `buyerName` for display the way
--     SupportTicket denormalises the submitter.
--   * `spaceId` / `serviceId` / `appointmentId` reference the provider-side
--     entities. They are TEXT, not uuid: "Space"/"Service"/"Appointment" all
--     have TEXT primary keys in supabase/schema.sql (all ids are text UUIDs per
--     DB_CONVENTIONS.md §2). Declaring these columns as uuid would make the
--     foreign keys invalid, so TEXT is required for referential integrity.
--   * `spaceId` is NOT NULL — every purchase is from exactly one provider.
--     `serviceId` / `appointmentId` are nullable (a purchase may be a bespoke
--     request not yet tied to a catalog Service, or not yet scheduled). Both
--     use ON DELETE SET NULL so deleting a provider's Service/Appointment does
--     not erase the buyer's purchase history.
--   * `amountCents` is an integer minor-unit amount (avoids float money bugs);
--     `currency` defaults to 'usd' (lowercase, Stripe convention).
--   * `status` is lowercase (matches the Deal/Appointment status convention),
--     constrained to the fulfilment lifecycle.
--
-- RLS is enabled with NO policies — every read/write goes through the server
-- with the service-role key (same posture as SupportTicket, the client portal,
-- and the rest of the app), so the table is closed to anon/authenticated roles
-- by default. Application-level isolation (filter by buyerUserId) is the
-- primary access control, exactly as DB_CONVENTIONS.md §7 requires.

CREATE TABLE IF NOT EXISTS "Purchase" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "buyerUserId"   text        NOT NULL,                       -- Clerk user id of the buyer
  "buyerEmail"    text,                                       -- denormalised for display
  "buyerName"     text,                                       -- denormalised for display
  "spaceId"       text        NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "serviceId"     text        REFERENCES "Service"(id) ON DELETE SET NULL,
  "appointmentId" text        REFERENCES "Appointment"(id) ON DELETE SET NULL,
  "title"         text        NOT NULL,
  "amountCents"   integer,
  "currency"      text        NOT NULL DEFAULT 'usd',
  "status"        text        NOT NULL DEFAULT 'requested'
    CHECK ("status" IN (
      'requested', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'
    )),
  "notes"         text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

-- Buyer "my purchases" view: every list/detail query filters by the signed-in
-- Clerk user, newest-first.
CREATE INDEX IF NOT EXISTS "Purchase_buyerUserId_createdAt_idx"
  ON "Purchase" ("buyerUserId", "createdAt" DESC);

-- Provider-side / marketplace lookups by the originating Space.
CREATE INDEX IF NOT EXISTS "Purchase_spaceId_idx"
  ON "Purchase" ("spaceId");

ALTER TABLE "Purchase" ENABLE ROW LEVEL SECURITY;
