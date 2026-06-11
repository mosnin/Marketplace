-- ============================================================================
-- Organization System: Agencies, Memberships, Invitations
-- ============================================================================
-- Adds:
--   1. User.platformRole (user | admin) — replaces Clerk-metadata-only admin
--   2. Agency table
--   3. AgencyMembership table
--   4. Space.agencyId (nullable link to Agency)
--   5. Invitation table
--
-- All new columns have safe defaults so existing rows are unaffected.
-- ============================================================================

-- 1. Add platform_role to User (defaults 'user' — all existing users safe)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "platformRole" text NOT NULL DEFAULT 'user'
  CHECK ("platformRole" IN ('user', 'admin'));

-- 2. Agency
CREATE TABLE IF NOT EXISTS "Agency" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          text NOT NULL,
  "ownerId"     text NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  "websiteUrl"  text,
  "logoUrl"     text,
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
-- One agency per owner
CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_owner  ON "Agency"("ownerId");
CREATE INDEX       IF NOT EXISTS idx_agency_status  ON "Agency"(status);

-- 3. AgencyMembership
CREATE TABLE IF NOT EXISTS "AgencyMembership" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"   text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  "userId"        text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('agency_owner', 'agency_manager', 'provider_member')),
  "invitedById"   text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("agencyId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_membership_agency ON "AgencyMembership"("agencyId");
CREATE INDEX IF NOT EXISTS idx_membership_user      ON "AgencyMembership"("userId");

-- 4. Link Space → Agency (nullable — all existing spaces untouched)
ALTER TABLE "Space"
  ADD COLUMN IF NOT EXISTS "agencyId" text REFERENCES "Agency"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_space_agency ON "Space"("agencyId");

-- 5. Invitation
CREATE TABLE IF NOT EXISTS "Invitation" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"   text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  email           text NOT NULL,
  "roleToAssign"  text NOT NULL CHECK ("roleToAssign" IN ('agency_manager', 'provider_member')),
  token           text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  "expiresAt"     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  "invitedById"   text REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invitation_agency ON "Invitation"("agencyId");
CREATE INDEX IF NOT EXISTS idx_invitation_email     ON "Invitation"(email);
CREATE INDEX IF NOT EXISTS idx_invitation_token     ON "Invitation"(token);
CREATE INDEX IF NOT EXISTS idx_invitation_status    ON "Invitation"(status);

-- 6. RLS for new tables (defense-in-depth; service role bypasses these)
ALTER TABLE "Agency"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgencyMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"          ENABLE ROW LEVEL SECURITY;
