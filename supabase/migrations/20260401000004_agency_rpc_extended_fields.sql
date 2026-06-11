-- Extend create_agency_with_owner RPC to accept the new agency onboarding fields.

CREATE OR REPLACE FUNCTION create_agency_with_owner(
  p_name                  TEXT,
  p_owner_id              TEXT,
  p_logo_url              TEXT DEFAULT NULL,
  p_website_url           TEXT DEFAULT NULL,
  p_office_address        TEXT DEFAULT NULL,
  p_office_phone          TEXT DEFAULT NULL,
  p_agent_count           TEXT DEFAULT NULL,
  p_agency_type        TEXT DEFAULT NULL,
  p_primary_market        TEXT DEFAULT NULL,
  p_commission_structure  TEXT DEFAULT NULL,
  p_geographic_coverage   TEXT DEFAULT NULL
) RETURNS TEXT AS $$
DECLARE
  v_agency_id TEXT;
BEGIN
  INSERT INTO "Agency" (
    name, "ownerId", "logoUrl", "websiteUrl",
    "officeAddress", "officePhone", "agentCount",
    "agencyType", "primaryMarket", "commissionStructure",
    "geographicCoverage"
  ) VALUES (
    p_name, p_owner_id, p_logo_url, p_website_url,
    p_office_address, p_office_phone, p_agent_count,
    p_agency_type, p_primary_market, p_commission_structure,
    p_geographic_coverage
  )
  RETURNING id INTO v_agency_id;

  INSERT INTO "AgencyMembership" ("agencyId", "userId", role)
    VALUES (v_agency_id, p_owner_id, 'agency_owner');

  RETURN v_agency_id;
END;
$$ LANGUAGE plpgsql;
