-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: User.accountType for users who signed up as agencies but are
-- still marked 'provider' in the DB.
--
-- Cause: before commit e27a6a6, the quick-path onboarding (OnboardingProvider)
-- offered a "Agency owner" role but its finish handler unconditionally
-- posted `accountType: 'provider'` to /api/onboarding/complete and routed
-- the user to /s/{slug}/koala. No Agency row was ever created, so the
-- DB tells a contradictory story: AIUserProfile.role = 'agency_owner'
-- but User.accountType = 'provider'.
--
-- This migration corrects the User row. It does NOT create a Agency —
-- those users still need to visit /agency and create their agency
-- (which the agency/create endpoint now supports for accountType='both'
-- provider-upgraders).
--
-- After this runs, `/auth/redirect` will continue to send those users to
-- /s/{slug} (because they have no AgencyMembership yet), and the
-- /agency page will be open to them as the self-serve upgrade path.
-- ═══════════════════════════════════════════════════════════════════════════

-- AIUserProfile is keyed on spaceId (one row per Space, not per User), so
-- bridge through Space.ownerId to reach the User.
--
-- Defensive wrapper: `AIUserProfile.role` is added by an earlier migration
-- (20260514000001_provider_onboarding_profile.sql). On databases that
-- haven't run that one yet, the column doesn't exist and a bare query
-- against `p.role` errors with 42703. Guard with information_schema so
-- this migration is safe to run on any schema state — if the role column
-- isn't there, pass 1 has nothing to backfill anyway and silently skips.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AIUserProfile'
      AND column_name = 'role'
  ) THEN
    UPDATE "User" u
    SET "accountType" = 'both'
    WHERE u."accountType" = 'provider'
      AND EXISTS (
        SELECT 1
        FROM "Space" s
        JOIN "AIUserProfile" p ON p."spaceId" = s.id
        WHERE s."ownerId" = u.id
          AND p.role = 'agency_owner'
      );
  END IF;
END $$;

-- Also catch the inverse: users who ALREADY own a Agency but whose
-- User row never had accountType updated (covers race conditions or
-- manual data inserts). agency_only and 'both' are both correct for
-- agency_owners depending on whether they have a personal workspace —
-- pick 'both' when a Space exists, 'agency_only' otherwise.

UPDATE "User" u
SET "accountType" = CASE
  WHEN EXISTS (SELECT 1 FROM "Space" s WHERE s."ownerId" = u.id) THEN 'both'
  ELSE 'agency_only'
END
FROM "Agency" b
WHERE b."ownerId" = u.id
  AND (u."accountType" = 'provider' OR u."accountType" IS NULL);
