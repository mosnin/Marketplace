-- Add privacyPolicyHtml column to SpaceSetting and Agency tables
-- Stores rich-text (HTML) privacy policy content

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "privacyPolicyHtml" text;

ALTER TABLE "Agency"
  ADD COLUMN IF NOT EXISTS "privacyPolicyHtml" text;
