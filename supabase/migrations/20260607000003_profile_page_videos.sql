-- ═══════════════════════════════════════════════════════════════════════════
-- ProfilePage.videos — YouTube links the provider features on their public
-- /p/[slug] page. Stored as [{ id, url, title }]; the public page derives
-- the thumbnail from the URL at render time.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ProfilePage"
  ADD COLUMN IF NOT EXISTS "videos" jsonb NOT NULL DEFAULT '[]';
