# API_CONTRACTS.md

Request/response contracts for all Koala API endpoints. Use this to prevent breaking changes when fixing bugs or adding features.

**Rule**: If you change an endpoint's request or response shape, update this file and verify all callers.

---

## Auth patterns

All protected routes use one of these auth helpers from `lib/api-auth.ts`:

| Helper | Returns | Use when |
|--------|---------|----------|
| `requireAuth()` | `{ userId }` or `401` | Route needs auth but not space context |
| `requireSpaceOwner(slug)` | `{ userId, space }` or `401/403/404` | Route operates on a specific workspace |
| `requireContactAccess(contactId)` | `{ userId, space }` or `401/403/404` | Route operates on a specific contact |
| `requireAgency()` | `{ agency, membership, dbUserId }` or throws | Agency dashboard routes |
| `requirePlatformAdmin()` | `{ userId }` or throws | Admin routes |

---

## Core CRM endpoints

### Contacts

#### `GET /api/contacts?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Query params**: `slug` (required), `search`, `type` (QUALIFICATION|APPOINTMENT|APPLICATION|ALL), `limit` (default 500, max 1000), `offset` (default 0)
- **Response**: `200` — `Contact[]`
- **Search**: ILIKE on name, email, phone, preferences (escaped)

#### `POST /api/contacts`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, name (required), email?, phone?, budget?, preferences?, services?, address?, notes?, type?, tags? }`
- **Validation**: name required (string, max 200 chars)
- **Response**: `201` — `Contact`
- **Side effect**: Async vector sync (`syncContact`)

#### `GET /api/contacts/[id]?slug=X`
- **Auth**: `requireSpaceOwner(slug)` + verify contact belongs to space
- **Response**: `200` — `Contact`

#### `PATCH /api/contacts/[id]`
- **Auth**: `requireContactAccess(contactId)`
- **Body**: Partial `Contact` fields
- **Response**: `200` — updated `Contact`

#### `DELETE /api/contacts/[id]`
- **Auth**: `requireContactAccess(contactId)`
- **Response**: `200` — `{ success: true }`

#### `POST /api/contacts/[id]/rescore`
- **Auth**: `requireContactAccess(contactId)`
- **Response**: `200` — `LeadScoringResult`

#### `GET /api/contacts/[id]/timeline`
- **Auth**: `requireContactAccess(contactId)`
- **Response**: `200` — Timeline events array

#### `POST /api/contacts/[id]/email`
- **Auth**: `requireContactAccess(contactId)`
- **Body**: Email content
- **Response**: `200` — Send result

#### `GET /api/contacts/[id]/activity`
- **Auth**: `requireContactAccess(contactId)`
- **Response**: `200` — Activity log entries

#### `POST /api/contacts/import`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: CSV/bulk contact data
- **Response**: `200` — Import result with counts

### Deals

#### `GET /api/deals?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Query params**: `slug` (required), `limit` (default 200, max 500), `offset` (default 0)
- **Response**: `200` — `Deal[]` with nested `DealStage` and `DealContact[]` with `Contact` names

#### `POST /api/deals`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, title (required), stageId (required), description?, value?, address?, priority?, contactIds? }`
- **Response**: `201` — `Deal`
- **Side effect**: Async vector sync, DealActivity log

#### `PATCH /api/deals/[id]`
- **Auth**: `requireAuth()` + verify deal belongs to user's space
- **Body**: Partial `Deal` fields
- **Response**: `200` — updated `Deal`
- **Side effect**: DealActivity log for stage/status changes

#### `DELETE /api/deals/[id]`
- **Auth**: `requireAuth()` + verify deal belongs to user's space
- **Response**: `200` — `{ success: true }`

#### `POST /api/deals/reorder`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, dealId, newStageId, newPosition }`
- **Response**: `200` — `{ success: true }`
- **Implementation**: Uses `reorder_deal` RPC (atomic with row locking)

#### `GET /api/deals/[id]/activity`
- **Auth**: `requireAuth()` + verify deal belongs to user's space
- **Response**: `200` — `DealActivity[]`

#### `POST /api/deals/[id]/activity`
- **Auth**: `requireAuth()` + verify deal belongs to user's space
- **Body**: `{ type, content?, metadata? }`
- **Response**: `201` — `DealActivity`

### Stages

#### `GET /api/stages?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `DealStage[]` ordered by position

#### `POST /api/stages`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, name (required), color?, position? }`
- **Response**: `201` — `DealStage`

#### `PATCH /api/stages/[id]`
- **Auth**: `requireAuth()` + verify stage belongs to user's space
- **Body**: Partial `DealStage` fields
- **Response**: `200` — updated `DealStage`

#### `DELETE /api/stages/[id]`
- **Auth**: `requireAuth()` + verify stage belongs to user's space
- **Response**: `200` — `{ success: true }`

---

## Public endpoints (no auth)

### `POST /api/public/apply`
- **Auth**: None (public)
- **Rate limit**: 10 submissions / IP / hour (Redis-based, fail-open)
- **Body**: Validated by `publicApplicationSchema` (Zod) — `{ slug, name, phone, email?, budget?, timeline?, preferredAreas?, notes?, moveInDate?, documents? }`
- **Dedup**: Same name + normalized phone within 2-minute window → returns existing (200, not 201)
- **Idempotency**: Redis lock on fingerprint
- **Response**: `201` — `{ id, scoring: LeadScoringResult }` | `200` (duplicate)
- **Side effects**: Creates Contact, triggers lead scoring, sends email notification

### `POST /api/appointments/book`
- **Auth**: None (public)
- **Body**: `{ slug, guestName, guestEmail, guestPhone?, serviceAddress?, notes?, startsAt, serviceProfileId? }`
- **Response**: `201` — Appointment object with `manageToken` | `409` (conflict/double-booking)
- **Validation**: `guestName` required, `guestEmail` required (valid format), `startsAt` required (not in past). `endsAt` auto-calculated from settings/profile duration.
- **Implementation**: Uses `book_appointment_atomic` RPC for atomic booking with conflict detection
- **Side effects**: Auto-creates Contact if no match by email. Sends confirmation email to guest. Sends notification email to space owner.

### `GET /api/appointments/available?slug=X&date=Y&serviceId=Z`
- **Auth**: None (public)
- **Query params**: `slug` (required), `date` (optional, YYYY-MM-DD, defaults to today), `serviceId` (optional)
- **Response**: `200` — `{ slots: [{ date, times: [ISO8601] }], duration, timezone, serviceProfileId, serviceProfiles: [{ id, name, address, appointmentDuration, isActive }] }`
- **Computation**: 14-day rolling window. Considers existing bookings, Google Calendar busy times, availability overrides (including recurring), service profile settings, buffer minutes

### `GET /api/appointments/manage?token=X`
- **Auth**: Guest manage token
- **Response**: `200` — Appointment details for self-service management

### `POST /api/appointments/manage`
- **Auth**: Guest manage token (in body)
- **Body**: `{ token, action: 'cancel' }`
- **Validation**: Cannot cancel within 1 hour of appointment. Cannot cancel completed appointments.
- **Response**: `200` — `{ success: true, status: 'cancelled' }`

### `POST /api/appointments/feedback`
- **Auth**: None (token-based)
- **Body**: `{ appointmentId, rating (1-5), comment? }`
- **Response**: `201` — `AppointmentFeedback`

---

## AI endpoints

### `POST /api/ai/task`
- **Auth**: `resolveToolContext(spaceSlug)` — resolves the caller, their space, and an abortable `ToolContext`; returns 401/403/404 on failure
- **Rate limit**: `30 tasks/hour` per user (key `ai:task:{userId}`, returns `429` with `{ error: 'Rate limit exceeded (30 tasks/hour). Please wait.' }`)
- **Body**: `{ spaceSlug: string, conversationId?: string | null, message: string }`
  - `message` is trimmed; empty → `400 message required`
  - `message` max length is `8000` chars → `400 message too long (8000 char max)`
  - `spaceSlug` required → `400 spaceSlug required`
  - If `conversationId` is missing or doesn't belong to the space, a new `Conversation` row is created (title auto-derived from the first 60 sanitised chars of the message, or `"Task"`)
- **Response**: `text/event-stream; charset=utf-8` (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`).
  Each frame is `event: <type>\ndata: <json>\n\n` where the JSON is an `AgentEvent` (see `lib/ai-tools/events.ts`). Every event carries monotonic `seq: number` and ISO `ts: string`. The union:

  | Event `type` | Key fields | When emitted |
  |---|---|---|
  | `text_delta` | `delta: string` | Each streamed assistant-text token |
  | `tool_call_start` | `callId, name, args, display?` | Read-only tool is about to run |
  | `tool_call_result` | `callId, ok, summary, data?, error?` | Tool finished (or errored) |
  | `permission_required` | `requestId, callId, name, args, summary, display?, otherPendingCalls?` | Mutating tool is pending — loop pauses |
  | `permission_resolved` | `requestId, callId, decision, editedArgs?` | Emitted by the approve endpoint after the user decides |
  | `turn_complete` | `reason: 'complete' \| 'paused' \| 'aborted'` | End-of-turn sentinel (always last) |
  | `error` | `message, code?: 'rate_limited' \| 'quota' \| 'internal' \| 'auth'` | Unrecoverable turn failure |

  Error responses before the stream opens use `NextResponse.json` with `{ error }` at `400`/`429`/`500`/`503` as appropriate.
- **Side effects**:
  - Persists the user message to `Message` (role `user`) before streaming
  - Persists the assistant turn to `Message` (role `assistant`, `blocks: MessageBlock[]`) once the loop completes or pauses — `blocks` is the canonical renderable transcript (text / tool_call / permission blocks; see `lib/ai-tools/blocks.ts`); `content` is a legacy concatenation of text blocks, falling back to `'(tool-only turn)'`
  - On `paused`, stashes a `PendingApprovalState` in Redis keyed by `requestId` (consumed by the approve endpoint)

### `POST /api/ai/task/approve/[requestId]`
- **Auth**: `requireAuth()` + the stashed `PendingApprovalState.userId` must equal the caller's `userId` (`403 Forbidden` otherwise)
- **Rate limit**: `60/hour` per user (key `ai:task-approve:{userId}`, returns `429 { error: 'Rate limit exceeded for approvals' }`)
- **Body**: `{ decision: 'approved' | 'denied', editedArgs?: Record<string, unknown> }`
  - `decision` must be one of those two literals → `400 decision must be "approved" or "denied"`
  - `editedArgs` is accepted only as a plain object (arrays ignored); overrides the pending call's args before execution (Phase 3d)
- **Errors**: `400` (bad body / missing `requestId`), `403` (not owner), `410 Approval request not found or expired` (state missing or already consumed), `503` (missing OpenAI key)
- **Response**: Same SSE shape as `/api/ai/task` — the continuation stream emits `permission_resolved`, the resumed `tool_call_start` / `tool_call_result` (or cascade `PermissionBlock`s on deny), optionally more `text_delta`, and a final `turn_complete`. If the resumed turn hits another mutating call, it re-emits `permission_required` and a new `PendingApprovalState` is stashed.
- **Side effects**: Atomically `consumePendingApproval(requestId)` (one-shot, no replays); writes a new assistant `Message` row for the continuation blocks.

### `GET /api/ai/conversations?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `Conversation[]` ordered by updatedAt desc

### `GET /api/ai/conversations/[id]`
- **Auth**: `requireAuth()` + verify conversation belongs to user's space
- **Response**: `200` — `Conversation` with messages

### `GET /api/ai/messages?slug=X&conversationId=Y`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `Message[]` ordered by createdAt asc

---

## Appointment management endpoints (authenticated)

### `GET /api/appointments?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `Appointment[]` with optional contact info

### `PATCH /api/appointments/[id]`
- **Auth**: `requireAuth()` + verify appointment belongs to user's space
- **Body**: `{ status?, guestName?, guestEmail?, guestPhone?, serviceAddress?, notes?, startsAt?, endsAt?, contactId? }`
- **Response**: `200` — updated `Appointment`
- **Side effects on status change**:
  - `completed` → Sets contact `followUpAt` to 24h later, sends follow-up email to guest, logs activity, updates contact type to APPOINTMENT
  - `no_show` → Sets contact `followUpAt` to 48h later
  - `cancelled` → Sends cancellation email

### `GET /api/appointments/[id]/prep`
- **Auth**: `requireAuth()` + verify appointment belongs to user's space
- **Response**: `200` — AI-generated appointment prep notes

### `POST /api/appointments/convert`
- **Auth**: `requireAuth()`
- **Body**: `{ appointmentId, slug }`
- **Response**: `201` — Created `Deal` from appointment

### Appointment services

#### `GET /api/appointments/services?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `AppointmentServiceProfile[]`

#### `POST /api/appointments/services`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, name, address?, appointmentDuration?, startHour?, endHour?, daysAvailable?, bufferMinutes? }`
- **Response**: `201` — `AppointmentServiceProfile`

#### `PATCH /api/appointments/services/[id]`
- **Auth**: `requireAuth()` + verify profile belongs to user's space
- **Response**: `200` — updated `AppointmentServiceProfile`

### Appointment overrides

#### `GET /api/appointments/overrides?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `AppointmentAvailabilityOverride[]`

#### `POST /api/appointments/overrides`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, date, isBlocked?, startHour?, endHour?, label?, recurrence?, endDate? }`
- **Response**: `201` — `AppointmentAvailabilityOverride`

#### `DELETE /api/appointments/overrides/[id]`
- **Auth**: `requireAuth()` + verify override belongs to user's space
- **Response**: `200`

### Appointment waitlist

#### `POST /api/appointments/waitlist`
- **Auth**: None (public)
- **Body**: `{ spaceId, guestName, guestEmail, guestPhone?, preferredDate, notes?, serviceProfileId? }`
- **Response**: `201` — `AppointmentWaitlist`

#### `POST /api/appointments/waitlist/notify`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ waitlistId }`
- **Response**: `200`

---

## Workspace & settings

### `PATCH /api/spaces`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: Space + SpaceSetting fields
- **Response**: `200` — updated space/settings

### `DELETE /api/spaces`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `{ success: true }`
- **Side effects**: Resets `User.onboard = false`, `onboardingCurrentStep = 1`

### `GET /api/onboarding`
- **Auth**: `requireAuth()`
- **Response**: `200` — `{ step, completed, user: { id, name, email, onboard, ... }, space: { id, slug, name, settings } | null }`

### `POST /api/onboarding`
- **Auth**: `requireAuth()`
- **Body**: `{ action, ...actionData }`
- **Actions and their payloads**:
  - `start` — no extra fields → `{ success: true }`
  - `save_step` + `{ step: number }` → `{ success: true }`
  - `save_profile` + `{ name, phone?, businessName }` → `{ success: true }`
  - `create_space` + `{ slug, intakePageTitle, intakePageIntro, businessName, logoUrl?, providerPhotoUrl? }` → `{ success: true, slug }` | `409` (slug taken)
  - `save_notifications` + `{ emailNotifications, defaultSubmissionStatus }` → `{ success: true }`
  - `complete` + `{ accountType?: 'provider' | 'agency_only' | 'both' }` → `{ success: true, onboard: true, onboardingCompletedAt }`
  - `check_slug` + `{ slug }` → `{ available: boolean, reason?: string }`
- **Side effects**: `create_space` uses RPC `create_space_with_defaults` (atomic). `complete` sets accountType if provided.

---

## Agency endpoints

### `POST /api/agency/create`
- **Auth**: `requireAuth()` + completed workspace
- **Response**: `201` — `{ agencyId }` | `409` (already exists)

### `POST /api/agency/invite`
- **Auth**: `requireAgency()`
- **Body**: `{ email, role }`
- **Response**: `201` — `Invitation`

### `POST /api/agency/invite/bulk`
- **Auth**: `requireAgency()`
- **Body**: `{ invitations: [{ email, role }] }`
- **Response**: `200` — Bulk result

### `GET /api/agency/stats`
- **Auth**: `requireAgency()`
- **Response**: `200` — Member counts, leads, applications

### `GET /api/agency/trends`
- **Auth**: `requireAgency()`
- **Response**: `200` — Time-series analytics

### `GET /api/agency/settings`
- **Auth**: `requireAgency()`
- **Response**: `200` — Agency settings

### `PATCH /api/agency/settings`
- **Auth**: `requireAgency()`
- **Body**: Agency fields (name, websiteUrl, logoUrl, joinCode)
- **Response**: `200` — Updated agency

### `GET /api/agency/export`
- **Auth**: `requireAgency()`
- **Response**: `200` — CSV export of member data

### `POST /api/agency/join`
- **Auth**: `requireAuth()`
- **Body**: `{ joinCode }`
- **Response**: `200` — Membership created

### `POST /api/agency/join-code`
- **Auth**: `requireAgency()`
- **Response**: `200` — Generated/refreshed join code

### Agency member management

#### `GET /api/agency/providers/[userId]`
- **Auth**: `requireAgency()` + verify member belongs to agency
- **Response**: `200` — Provider details with stats

#### `DELETE /api/agency/members/[id]`
- **Auth**: `requireAgency()`
- **Response**: `200`

#### `PATCH /api/agency/members/[id]/role`
- **Auth**: `requireAgency()`
- **Body**: `{ role }`
- **Response**: `200` — Updated membership

### `GET /api/agency/notifications`
- **Auth**: `requireAgency()`
- **Response**: `200` — `AgencyNotification[]`

---

## Admin endpoints

### `GET /api/admin/agencies`
- **Auth**: `requirePlatformAdmin()`
- **Response**: `200` — All agencies with owner info and member counts

### `PATCH /api/admin/agencies/[id]`
- **Auth**: `requirePlatformAdmin()`
- **Body**: `{ status: 'active' | 'suspended' }`
- **Response**: `200`

### `GET /api/admin/invitations`
- **Auth**: `requirePlatformAdmin()`
- **Response**: `200` — All invitations

### `DELETE /api/admin/invitations/[id]`
- **Auth**: `requirePlatformAdmin()`
- **Response**: `200`

### `DELETE /api/admin/memberships/[id]`
- **Auth**: `requirePlatformAdmin()`
- **Response**: `200`

### `POST /api/admin/actions`
- **Auth**: `requirePlatformAdmin()`
- **Body**: Admin action payload
- **Response**: `200`

---

## Invitation endpoints

### `GET /api/invitations/[token]`
- **Auth**: None (public read)
- **Response**: `200` — Agency name + invitation details (no sensitive data)

### `POST /api/invitations/[token]`
- **Auth**: `requireAuth()`
- **Response**: `200` — Invitation accepted, membership created

---

## Utility endpoints

### `GET /api/health`
- **Auth**: `requireAuth()` + admin role in Clerk publicMetadata
- **Response**: `200` — `{ status: 'ok', db: 'ok' | 'error' }` (opaque, never exposes internals)

### `GET /api/appointments/gcal?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `{ connected, configured, authUrl?, token? }`

### `POST /api/appointments/gcal`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ slug, action }` where action is:
  - `exchange_code` + `{ code }` → `{ connected: true }` (OAuth code exchange)
  - `sync_appointment` + `{ appointmentId }` → `{ synced: true, googleEventId }` (create/update GCal event)
  - `disconnect` → `{ connected: false }` (remove stored token)

### `GET /api/search?slug=X&q=Y`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `{ contacts: Contact[], deals: Deal[] }` (parallel search, max 8 each)

### `POST /api/vectorize/sync`
- **Auth**: `requireAuth()`
- **Body**: `{ slug }`
- **Response**: `200` — Sync result

### `POST /api/documents`
- **Auth**: `requireAuth()`
- **Body**: FormData with file + contactId
- **Response**: `201` — `ContactDocument`

### `GET /api/notifications?slug=X`
- **Auth**: `requireSpaceOwner(slug)`
- **Response**: `200` — `[{ id, type, title, description, href, createdAt, priority }]`
- **Types**: `new_lead`, `upcoming_appointment`, `follow_up_due`, `waitlist`, `appointment_needs_action`
- **Computed in real-time** from: new unread leads, upcoming appointments (24h), due follow-ups, waitlist entries, completed appointments without deals

### `POST /api/applications/compare`
- **Auth**: `requireSpaceOwner(slug)`
- **Body**: `{ contactIds }`
- **Response**: `200` — Side-by-side application comparison

### `PATCH /api/applications/status`
- **Auth**: `requireAuth()`
- **Body**: `{ contactId, status, note? }`
- **Response**: `200`

### `GET /api/applications/pdf?contactId=X`
- **Auth**: `requireAuth()` + verify contact access
- **Response**: `200` — PDF binary

---

## CRON endpoints

### `POST /api/cron/follow-up-reminders`
- **Auth**: `CRON_SECRET` header validation
- **Response**: `200` — Processed reminders count

### `POST /api/appointments/reminders`
- **Auth**: `CRON_SECRET` header validation
- **Response**: `200` — Sent reminders count

---

## Common error responses

| Status | Meaning | When |
|--------|---------|------|
| `400` | Bad request | Missing required fields, validation failure |
| `401` | Unauthorized | No auth token / invalid session |
| `403` | Forbidden | Authenticated but not authorized for this resource |
| `404` | Not found | Resource doesn't exist or not in user's space |
| `409` | Conflict | Duplicate (agency already exists, appointment double-booking) |
| `429` | Rate limited | Too many submissions (public endpoints) |
| `500` | Server error | Unhandled exception |

Error response shape: `{ error: string }`
