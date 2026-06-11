-- ============================================================================
-- Purge the legacy agency-Koala rows from the shared provider chat tables.
--
-- The deferred follow-up to 20260616000000_agency_chat_separate_storage.sql.
-- That migration copied every '[AGENCY_KOALA] <agencyId>' conversation (and
-- its messages) into the structurally-isolated "AgencyConversation" /
-- "AgencyMessage" tables, keyed by agencyId, but intentionally did NOT delete
-- the originals — the purge was deferred until the owner verified the new tables
-- carry the full history. The owner has verified; this is that purge.
--
-- SAFETY:
--   * Only deletes a "Conversation" row when a "AgencyConversation" with the
--     SAME id exists — i.e. the data is provably already in the new table. The
--     backfill used the same primary key, so this EXISTS check is exact.
--   * "Message" rows cascade via Message.conversationId -> Conversation(id)
--     ON DELETE CASCADE (see 20260319000000_conversation_table.sql), and the
--     agency messages already live independently in "AgencyMessage", so the
--     cascade only removes the now-redundant shared-table copies.
--   * Idempotent: re-running deletes nothing once the rows are gone.
--
-- DELIBERATELY OUT OF SCOPE: team chat ('[AGENCY_CHAT]%'). That surface has
-- NOT been migrated to its own tables yet — the shared "Conversation"/"Message"
-- rows are still its LIVE storage. Deleting them would destroy real team-chat
-- history. They stay until team chat gets its own separate-storage migration;
-- the provider surface keeps hiding them via the reserved-title guards.
-- ============================================================================

DELETE FROM "Conversation" c
WHERE c."title" LIKE '[AGENCY_KOALA] %'
  AND EXISTS (
    SELECT 1 FROM "AgencyConversation" bc WHERE bc."id" = c."id"
  );
