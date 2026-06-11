/**
 * All tools known to the registry. New tools get appended here when they
 * ship. The list is grouped by category and within each category by
 * read-only first, then mutating (approval-gated) — keep that order.
 *
 * ─── Important: dual-runtime split ────────────────────────────────────────
 *
 * These TypeScript tools run in the Next.js loop (`lib/ai-tools/loop.ts`)
 * — the deprecated approval-resume path and the in-process sub-agent
 * skills. **The provider's chat agent runs in Modal/Python** and has its
 * OWN tool catalog at `agent/tools/*.py`.
 *
 * Adding a tool here does NOT add it to the chat the provider uses. The
 * two lists are hand-maintained today. If you need a new verb available
 * to the chat agent, you also need a Python equivalent in `agent/tools/`.
 *
 * The right fix is to consolidate runtimes (one source of truth) or
 * generate the Python catalog from this list at deploy time. Until that
 * lands, this comment exists to keep us honest about the gap.
 *
 * ─── Contract ─────────────────────────────────────────────────────────────
 *
 * Every tool is enforced at compile time via the discriminated union in
 * `lib/ai-tools/types.ts`: mutating tools must have `summariseCall` and
 * `rateLimit`. Drift the types can't catch (snake_case names, uniqueness,
 * description shape) is enforced by `tests/lib/ai-tools-registry-contract.test.ts`,
 * which walks this list at test time. The test is the spec.
 */

import type { ToolDefinition } from '../types';

// People — find + state changes + activity capture
import { findPersonTool } from './find-person';
import { addPersonTool } from './add-person';
import { logCallTool } from './log-call';
import { logMeetingTool } from './log-meeting';
import { setFollowupTool } from './set-followup';
import { clearFollowupTool } from './clear-followup';
import { markPersonHotTool } from './mark-person-hot';
import { markPersonColdTool } from './mark-person-cold';
import { archivePersonTool } from './archive-person';
import { mergePersonsTool } from './merge-persons';
import { noteOnPersonTool } from './note-on-person';

// Deals — find + lifecycle + activity capture
import { findDealTool } from './find-deal';
import { createDealTool } from './create-deal';
import { moveDealStageTool } from './move-deal-stage';
import { updateDealValueTool } from './update-deal-value';
import { updateDealCloseDateTool } from './update-deal-close-date';
import { updateDealProbabilityTool } from './update-deal-probability';
import { attachServiceToDealTool } from './attach-service-to-deal';
import { markDealWonTool } from './mark-deal-won';
import { markDealLostTool } from './mark-deal-lost';
import { noteOnDealTool } from './note-on-deal';
import { addChecklistItemTool } from './add-checklist-item';

// Appointments
import { scheduleAppointmentTool } from './schedule-appointment';
import { rescheduleAppointmentTool } from './reschedule-appointment';
import { cancelAppointmentTool } from './cancel-appointment';
import { findAppointmentsTool } from './find-appointments';

// Services
import { findServiceTool } from './find-service';
import { findComparableServicesTool } from './find-comparable-services';
import { addServiceTool } from './add-service';
import { updateServiceStatusTool } from './update-service-status';
import { noteOnServiceTool } from './note-on-service';

// Calendar
import { checkAvailabilityTool } from './check-availability';
import { blockTimeTool } from './block-time';
import { proposeAppointmentTimesTool } from './propose-appointment-times';

// Pipeline aggregates
import { pipelineSummaryTool } from './pipeline-summary';
import { findStuckDealsTool } from './find-stuck-deals';
import { findQuietHotPersonsTool } from './find-quiet-hot-persons';
import { findOverdueFollowupsTool } from './find-overdue-followups';

// Communication — drafting + sending + post-hoc logging
import { draftEmailTool } from './draft-email';
import { draftSmsTool } from './draft-sms';
import { sendEmailTool } from './send-email';
import { sendSmsTool } from './send-sms';
import { sendServicePacketTool } from './send-service-packet';
import { logEmailSentTool } from './log-email-sent';
import { logSmsSentTool } from './log-sms-sent';

// Agency — agency-role gated
import { summarizeProviderTool } from './summarize-provider';
import { analyzeProviderTool } from './analyze-provider';
import { assignLeadToProviderTool } from './assign-lead-to-provider';
import { requestDealReviewTool } from './request-deal-review';

// Memory
import { recallHistoryTool } from './recall-history';
import { readAttachmentTool } from './read-attachment';

// Files (Wasabi-backed user uploads)
import { listFilesTool } from './list-files';
import { readFileTool } from './read-file';
import { attachFileToServiceTool } from './attach-file-to-service';

// Planning
import { createPlanTool } from './plan';

/**
 * Domain tools only. The orchestrator's `delegate_to_subagent` tool is
 * intentionally NOT in this list — it gets added at the `registry` layer.
 * That separation breaks the cycle where delegate-to-subagent needs
 * skills/registry which needs ALL_TOOLS for validation. It also keeps this
 * list safe to pass into `validateSkill` as a pool of tools a sub-agent is
 * allowed to use (sub-agents calling sub-agents isn't a feature we want).
 */
export const ALL_TOOLS: ToolDefinition[] = [
  // ── People ─────────────────────────────────────────────────────────────
  findPersonTool as ToolDefinition,
  addPersonTool as ToolDefinition,
  logCallTool as ToolDefinition,
  logMeetingTool as ToolDefinition,
  setFollowupTool as ToolDefinition,
  clearFollowupTool as ToolDefinition,
  markPersonHotTool as ToolDefinition,
  markPersonColdTool as ToolDefinition,
  archivePersonTool as ToolDefinition,
  mergePersonsTool as ToolDefinition,
  noteOnPersonTool as ToolDefinition,

  // ── Deals ──────────────────────────────────────────────────────────────
  findDealTool as ToolDefinition,
  createDealTool as ToolDefinition,
  moveDealStageTool as ToolDefinition,
  updateDealValueTool as ToolDefinition,
  updateDealCloseDateTool as ToolDefinition,
  updateDealProbabilityTool as ToolDefinition,
  attachServiceToDealTool as ToolDefinition,
  markDealWonTool as ToolDefinition,
  markDealLostTool as ToolDefinition,
  noteOnDealTool as ToolDefinition,
  addChecklistItemTool as ToolDefinition,

  // ── Appointments ──────────────────────────────────────────────────────────────
  scheduleAppointmentTool as ToolDefinition,
  rescheduleAppointmentTool as ToolDefinition,
  cancelAppointmentTool as ToolDefinition,
  findAppointmentsTool as ToolDefinition,

  // ── Services ─────────────────────────────────────────────────────────
  findServiceTool as ToolDefinition,
  findComparableServicesTool as ToolDefinition,
  addServiceTool as ToolDefinition,
  updateServiceStatusTool as ToolDefinition,
  noteOnServiceTool as ToolDefinition,

  // ── Calendar ───────────────────────────────────────────────────────────
  checkAvailabilityTool as ToolDefinition,
  blockTimeTool as ToolDefinition,
  proposeAppointmentTimesTool as ToolDefinition,

  // ── Pipeline aggregates ────────────────────────────────────────────────
  pipelineSummaryTool as ToolDefinition,
  findStuckDealsTool as ToolDefinition,
  findQuietHotPersonsTool as ToolDefinition,
  findOverdueFollowupsTool as ToolDefinition,

  // ── Communication ──────────────────────────────────────────────────────
  draftEmailTool as ToolDefinition,
  draftSmsTool as ToolDefinition,
  sendEmailTool as ToolDefinition,
  sendSmsTool as ToolDefinition,
  sendServicePacketTool as ToolDefinition,
  logEmailSentTool as ToolDefinition,
  logSmsSentTool as ToolDefinition,

  // ── Agency ──────────────────────────────────────────────────────────
  summarizeProviderTool as ToolDefinition,
  analyzeProviderTool as ToolDefinition,
  assignLeadToProviderTool as ToolDefinition,
  requestDealReviewTool as ToolDefinition,

  // ── Memory ─────────────────────────────────────────────────────────────
  recallHistoryTool as ToolDefinition,
  readAttachmentTool as ToolDefinition,
  listFilesTool as ToolDefinition,
  readFileTool as ToolDefinition,
  attachFileToServiceTool as ToolDefinition,

  // ── Planning ───────────────────────────────────────────────────────────
  createPlanTool as ToolDefinition,
];
