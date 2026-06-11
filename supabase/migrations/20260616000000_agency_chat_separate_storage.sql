-- ============================================================================
-- Agency Koala conversations move to their OWN tables (structural isolation).
--
-- THE BUG THIS CLOSES
-- Agency Koala conversations and provider Koala conversations used to live in
-- the SAME "Conversation"/"Message" tables, both keyed by "spaceId" (the agency
-- owner's personal Space). They were distinguished ONLY by a title prefix
-- '[AGENCY_KOALA] <agencyId>'. That string-prefix boundary leaked
-- agency-private data onto the provider dashboard whenever a guard was missed.
-- We eliminate the shared storage: agency conversations get their own tables,
-- keyed by "agencyId", so the boundary is STRUCTURAL, not a string match.
--
-- THIS MIGRATION IS ADDITIVE AND IDEMPOTENT.
-- It creates the new tables, then copies the existing agency rows across. It
-- does NOT delete the original "Conversation"/"Message" rows. The provider-side
-- guards (NOT LIKE '[AGENCY_KOALA]%') already hide those rows from the provider
-- surfaces, so leaving them in place is harmless and reversible. The destructive
-- purge of the old agency rows is DEFERRED to a separate, later migration, run
-- only after the owner has verified the new tables carry the full history.
--
-- Re-running this migration is safe: CREATE TABLE IF NOT EXISTS for the tables,
-- ON CONFLICT (id) DO NOTHING for every backfilled row.
--
-- Out of scope (still shared storage, migrate next): team chat
-- ('[AGENCY_CHAT]%' in "Conversation"/"Message", app/api/agency/chat/*).
-- ============================================================================

-- ── 1. New tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AgencyConversation" (
  "id"          text PRIMARY KEY,
  "agencyId" text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  "title"       text NOT NULL DEFAULT 'New conversation',
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  "updatedAt"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AgencyConversation_agencyId_updatedAt_idx"
  ON "AgencyConversation" ("agencyId", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "AgencyMessage" (
  "id"             text PRIMARY KEY,
  "agencyId"    text NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  "conversationId" text NOT NULL REFERENCES "AgencyConversation"(id) ON DELETE CASCADE,
  "role"           text NOT NULL,
  "content"        text NOT NULL DEFAULT '',
  "blocks"         jsonb,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AgencyMessage_conversationId_createdAt_idx"
  ON "AgencyMessage" ("conversationId", "createdAt");

-- ── 2. Backfill conversations (additive, non-destructive) ───────────────────
-- For every existing agency-Koala "Conversation", create a "AgencyConversation"
-- with the SAME id so the URL "?conversationId=" links keep resolving. The
-- agencyId is the FIRST whitespace-delimited token AFTER the prefix
-- '[AGENCY_KOALA] ' (the title may have extra auto-title text after the id,
-- e.g. '[AGENCY_KOALA] brk_123 Pipeline question' — we take only 'brk_123').
-- The JOIN to "Agency" guards the FK: a malformed title whose parsed token
-- is not a real agency id is simply skipped, so no FK violation is possible.

INSERT INTO "AgencyConversation" ("id", "agencyId", "title", "createdAt", "updatedAt")
SELECT
  c."id",
  b."id" AS "agencyId",
  c."title",
  c."createdAt",
  c."updatedAt"
FROM "Conversation" c
JOIN "Agency" b
  ON b."id" = split_part(substring(c."title" FROM char_length('[AGENCY_KOALA] ') + 1), ' ', 1)
WHERE c."title" LIKE '[AGENCY_KOALA] %'
ON CONFLICT ("id") DO NOTHING;

-- ── 3. Backfill messages (additive, non-destructive) ────────────────────────
-- Copy every "Message" whose conversation now exists in "AgencyConversation".
-- agencyId comes from the matching "AgencyConversation" so it can never
-- disagree with the parent and can never violate the FK.

INSERT INTO "AgencyMessage" ("id", "agencyId", "conversationId", "role", "content", "blocks", "createdAt")
SELECT
  m."id",
  bc."agencyId",
  m."conversationId",
  m."role",
  m."content",
  m."blocks",
  m."createdAt"
FROM "Message" m
JOIN "AgencyConversation" bc
  ON bc."id" = m."conversationId"
ON CONFLICT ("id") DO NOTHING;

-- NOTE: No DELETE. The original "Conversation"/"Message" agency rows remain in
-- place. The purge is a separate, later migration run after owner verification.
