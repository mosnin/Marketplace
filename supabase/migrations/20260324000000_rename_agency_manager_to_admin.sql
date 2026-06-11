-- Rename agency_manager → agency_admin across agency role system
-- This creates a clearer hierarchy: agency_owner > agency_admin > provider_member

-- 1. Update existing membership rows
UPDATE "AgencyMembership"
SET role = 'agency_admin'
WHERE role = 'agency_manager';

-- 2. Update existing invitation rows
UPDATE "Invitation"
SET "roleToAssign" = 'agency_admin'
WHERE "roleToAssign" = 'agency_manager';

-- 3. Drop existing CHECK constraints by querying pg_constraint catalog
--    (constraint names are auto-generated and may vary across Postgres versions)
DO $$
DECLARE
  _con_name text;
BEGIN
  -- Drop all CHECK constraints on AgencyMembership.role
  FOR _con_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'AgencyMembership'
      AND att.attname = 'role'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE "AgencyMembership" DROP CONSTRAINT %I', _con_name);
  END LOOP;

  -- Drop all CHECK constraints on Invitation.roleToAssign
  FOR _con_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'Invitation'
      AND att.attname = 'roleToAssign'
      AND con.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE "Invitation" DROP CONSTRAINT %I', _con_name);
  END LOOP;
END $$;

-- 4. Add new CHECK constraints with known names
ALTER TABLE "AgencyMembership"
  ADD CONSTRAINT "AgencyMembership_role_check"
  CHECK (role IN ('agency_owner', 'agency_admin', 'provider_member'));

ALTER TABLE "Invitation"
  ADD CONSTRAINT "Invitation_roleToAssign_check"
  CHECK ("roleToAssign" IN ('agency_admin', 'provider_member'));
