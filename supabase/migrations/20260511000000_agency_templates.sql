-- ============================================================================
-- Agency-Scoped Message Templates (Phase BP6a): schema + data migration
-- ============================================================================
-- WHY: Until now, the "agency library" of message templates was stored as a
-- JSON array stuffed into the `content` column of a Note row whose title was
-- the magic string '[AGENCY_TEMPLATES]', scoped to the agency_owner's personal
-- Space. That was a deliberate hack to ship the feature without a migration:
-- it has no referential integrity, no real agency scoping (a second agency
-- space for the same owner would silently share the same blob), no way to
-- track template versions, and no way to record that a template has been
-- published out to agents' personal MessageTemplate rows. It also couldn't
-- survive renaming the Note or an agency accidentally editing the JSON by hand.
--
-- This migration introduces a proper `AgencyTemplate` table keyed on
-- Agency(id), adds provenance columns (sourceTemplateId, sourceVersion) to
-- the existing per-space `MessageTemplate` so published copies can be tracked
-- back to the source, and performs a one-shot extraction of every legacy
-- '[AGENCY_TEMPLATES]' Note into real rows. The old Note rows are intentionally
-- LEFT IN PLACE so we have a rollback window — a follow-up migration
-- (BP6-cleanup) will delete them once the new API has been live long enough to
-- trust. The extraction is idempotent (guarded by WHERE NOT EXISTS on
-- agencyId + name) and silently skips any legacy Note whose owning Space
-- has no agencyId, since such rows have no agency to attach to.
-- ============================================================================

-- 1. AgencyTemplate ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AgencyTemplate" (
  id                 text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "agencyId"      text        NOT NULL REFERENCES "Agency"(id) ON DELETE CASCADE,
  name               text        NOT NULL,
  category           text        NOT NULL CHECK (category IN ('follow-up', 'intro', 'closing', 'appointment-invite')),
  channel            text        NOT NULL CHECK (channel IN ('sms', 'email', 'note')),
  subject            text,                              -- email-only; NULL for sms / note
  body               text        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  "publishedAt"      timestamptz,
  "publishedCount"   integer     NOT NULL DEFAULT 0,    -- # of agents that received the most-recent publish
  "createdByUserId"  text        REFERENCES "User"(id) ON DELETE SET NULL,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);

-- 2. Provenance on MessageTemplate -----------------------------------------
--    sourceTemplateId: which AgencyTemplate this agent-local row came from
--                      (NULL = agent-authored, never pushed from an agency).
--    sourceVersion:    the AgencyTemplate.version at the time of the last
--                      push to this agent. NULL means the agent has edited
--                      locally since the last push (or it was never pushed).
ALTER TABLE "MessageTemplate"
  ADD COLUMN IF NOT EXISTS "sourceTemplateId" text REFERENCES "AgencyTemplate"(id) ON DELETE SET NULL;

ALTER TABLE "MessageTemplate"
  ADD COLUMN IF NOT EXISTS "sourceVersion" integer;

-- 3. Indexes ---------------------------------------------------------------
-- Agency's template list — most-recently-edited first, scoped to agency.
CREATE INDEX IF NOT EXISTS idx_agency_template_agency_updated
  ON "AgencyTemplate" ("agencyId", "updatedAt" DESC);

-- Partial index: publish SQL needs O(log n) lookup of "all agent copies of
-- this source template" without scanning the full MessageTemplate table.
CREATE INDEX IF NOT EXISTS idx_message_template_source
  ON "MessageTemplate" ("sourceTemplateId")
  WHERE "sourceTemplateId" IS NOT NULL;

-- 4. One-shot data migration from the legacy '[AGENCY_TEMPLATES]' Note -----
--    Legacy JSON element shape (per item in the top-level array):
--      {
--        "id":        string,       -- ignored; we mint fresh ids
--        "name":      string,       -- -> AgencyTemplate.name
--        "category":  string,       -- -> AgencyTemplate.category (must match CHECK)
--        "body":      string,       -- -> AgencyTemplate.body
--        "createdBy": string,       -- -> createdByUserId IF it exists in User(id), else NULL
--        "createdAt": ISO timestamp, -- ignored; we use now()
--        "updatedAt": ISO timestamp  -- ignored; we use now()
--      }
--
--    Guards:
--      * Space with no agencyId -> whole Note skipped.
--      * Note with unparseable / non-array content -> skipped (jsonb_array_elements would throw).
--      * Per-template row is skipped if a row with the same (agencyId, name)
--        already exists — makes this migration safe to re-run and idempotent.
--      * createdBy that doesn't resolve to a User.id -> stored as NULL (no
--        FK violation, and we don't lose the template).
--      * category values that don't match the CHECK are skipped with a NOTICE
--        rather than aborting the whole migration.
DO $$
DECLARE
  note_rec         record;
  tmpl             jsonb;
  v_agency_id   text;
  v_name           text;
  v_category       text;
  v_body           text;
  v_created_by_raw text;
  v_created_by     text;
  v_parsed         jsonb;
BEGIN
  FOR note_rec IN
    SELECT n.id AS note_id, n.content, n."spaceId", s."agencyId" AS agency_id
    FROM "Note" n
    JOIN "Space" s ON s.id = n."spaceId"
    WHERE n.title = '[AGENCY_TEMPLATES]'
  LOOP
    -- Skip notes whose owning space isn't attached to an agency.
    IF note_rec.agency_id IS NULL THEN
      RAISE NOTICE 'Skipping legacy [AGENCY_TEMPLATES] note % (space % has no agencyId)',
        note_rec.note_id, note_rec."spaceId";
      CONTINUE;
    END IF;

    -- Defensive JSON parse — legacy content might be '', malformed, or not an array.
    BEGIN
      v_parsed := note_rec.content::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Skipping legacy [AGENCY_TEMPLATES] note % (unparseable JSON)', note_rec.note_id;
      CONTINUE;
    END;

    IF v_parsed IS NULL OR jsonb_typeof(v_parsed) <> 'array' THEN
      RAISE NOTICE 'Skipping legacy [AGENCY_TEMPLATES] note % (content is not a JSON array)', note_rec.note_id;
      CONTINUE;
    END IF;

    v_agency_id := note_rec.agency_id;

    FOR tmpl IN SELECT * FROM jsonb_array_elements(v_parsed)
    LOOP
      v_name           := NULLIF(tmpl->>'name', '');
      v_category       := NULLIF(tmpl->>'category', '');
      v_body           := NULLIF(tmpl->>'body', '');
      v_created_by_raw := NULLIF(tmpl->>'createdBy', '');

      -- Minimum viable row — skip junk.
      IF v_name IS NULL OR v_body IS NULL OR v_category IS NULL THEN
        RAISE NOTICE 'Skipping template in note % (missing name/category/body)', note_rec.note_id;
        CONTINUE;
      END IF;

      -- Enforce the CHECK ourselves so one bad row doesn't abort the DO block.
      IF v_category NOT IN ('follow-up', 'intro', 'closing', 'appointment-invite') THEN
        RAISE NOTICE 'Skipping template "%" in note % (unknown category %)',
          v_name, note_rec.note_id, v_category;
        CONTINUE;
      END IF;

      -- Resolve createdBy -> User.id. The legacy field could be either a
      -- User.id or (in older data) a Clerk id; try both, prefer User.id.
      v_created_by := NULL;
      IF v_created_by_raw IS NOT NULL THEN
        SELECT u.id INTO v_created_by
        FROM "User" u
        WHERE u.id = v_created_by_raw
        LIMIT 1;

        IF v_created_by IS NULL THEN
          SELECT u.id INTO v_created_by
          FROM "User" u
          WHERE u."clerkId" = v_created_by_raw
          LIMIT 1;
        END IF;
      END IF;

      -- Idempotency guard: don't duplicate on re-run.
      INSERT INTO "AgencyTemplate" (
        "agencyId", name, category, channel, subject, body,
        version, "publishedAt", "publishedCount", "createdByUserId"
      )
      SELECT
        v_agency_id,
        v_name,
        v_category,
        'note',          -- legacy JSON has no channel; 'note' is the safe bucket
        NULL,            -- no subject in legacy data
        v_body,
        1,
        NULL,
        0,
        v_created_by
      WHERE NOT EXISTS (
        SELECT 1 FROM "AgencyTemplate" bt
        WHERE bt."agencyId" = v_agency_id
          AND bt.name = v_name
      );
    END LOOP;
  END LOOP;
END
$$;

-- 5. RLS --------------------------------------------------------------------
-- Enabled for defense-in-depth; no policies, because API routes use the
-- service role (same pattern as MessageTemplate / Agency).
ALTER TABLE "AgencyTemplate" ENABLE ROW LEVEL SECURITY;
