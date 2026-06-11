-- Add agencyId to Contact so agency intake leads are queryable by agency
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "agencyId" text REFERENCES "Agency"(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contact_agency ON "Contact"("agencyId");
