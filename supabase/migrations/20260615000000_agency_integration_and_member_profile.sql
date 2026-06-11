-- ============================================================================
-- Agency-level integrations + per-member agency profile customization.
--
-- Two additive, tiered features for agency owners/admins (NOT provider
-- members — that gate is enforced in the API layer via requireAgency /
-- canEditSettings, see lib/permissions.ts):
--
--   1. "AgencyIntegrationConnection" — the agency analogue of
--      "IntegrationConnection" (20260525000000). Each admin/owner connects
--      their OWN third-party accounts (inbox, calendar, social) AT the
--      agency level. Keyed on (agencyId, userId, toolkit) so two
--      admins can each connect their own Gmail without colliding. Composio
--      still holds the OAuth tokens; this table holds the pointer + status +
--      audit, exactly like the provider table.
--
--   2. Per-member agency profile fields on "AgencyMembership" — so an
--      owner/admin can present a profile (display name, title, bio, photo,
--      phone) within the agency, mirroring the provider profile on
--      SpaceSetting. Per-member (not per-agency) because each admin has
--      their own profile; the agency's own identity already lives on the
--      "Agency" row (name, logoUrl, websiteUrl).
--
-- Additive and idempotent: IF NOT EXISTS, nullable columns, no destructive
-- DDL. Does not touch "IntegrationConnection", "SpaceSetting", or any provider
-- flow.
-- ============================================================================

-- ── 1. Agency-level integration connections ──────────────────────────────

CREATE TABLE IF NOT EXISTS "AgencyIntegrationConnection" (
  "id"                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"          TEXT NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  "userId"               TEXT NOT NULL,                    -- Clerk userId of the admin/owner who connected
  "toolkit"              TEXT NOT NULL,                    -- composio toolkit slug, e.g. 'gmail'
  "composioConnectionId" TEXT NOT NULL,                    -- the connected-account id Composio returns
  "status"               TEXT NOT NULL DEFAULT 'active'
                           CHECK ("status" IN ('active', 'expired', 'revoked', 'failed')),
  "label"                TEXT,                             -- human-readable: 'work@example.com'
  "lastError"            TEXT,                             -- on 'failed' / 'expired'
  "lastUsedAt"           TIMESTAMPTZ,
  "createdAt"            TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active connection per (agency, userId, toolkit). Disconnect flips
-- the prior row's status to 'revoked' so this partial unique index stays
-- clean — same invariant the provider table holds.
CREATE UNIQUE INDEX IF NOT EXISTS "AgencyIntegrationConnection_active_unique"
  ON "AgencyIntegrationConnection" ("agencyId", "userId", "toolkit")
  WHERE "status" = 'active';

CREATE INDEX IF NOT EXISTS "AgencyIntegrationConnection_agencyId_idx"
  ON "AgencyIntegrationConnection" ("agencyId", "status");

CREATE INDEX IF NOT EXISTS "AgencyIntegrationConnection_userId_idx"
  ON "AgencyIntegrationConnection" ("userId");

ALTER TABLE "AgencyIntegrationConnection" ENABLE ROW LEVEL SECURITY;

-- ── 2. Per-member agency profile fields ─────────────────────────────────────
-- Mirror of the provider profile (SpaceSetting.bio / socialLinks / phoneNumber /
-- businessName / providerPhotoUrl) but scoped to a single agency member.

ALTER TABLE "AgencyMembership" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "AgencyMembership" ADD COLUMN IF NOT EXISTS "title"       TEXT;
ALTER TABLE "AgencyMembership" ADD COLUMN IF NOT EXISTS "bio"         TEXT;
ALTER TABLE "AgencyMembership" ADD COLUMN IF NOT EXISTS "photoUrl"    TEXT;
ALTER TABLE "AgencyMembership" ADD COLUMN IF NOT EXISTS "phone"       TEXT;
