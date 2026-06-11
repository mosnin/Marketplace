"""Agency write tools — the "command your team" suite.

Six tools that let the agency actually ACT through Koala, not just see:

  reassign_lead            — move an agency-routed lead from one provider to
                             another, matching the assignLeadToProvider() flow
                             the Next.js /api/agency/assign-lead route uses.
  flag_deal_for_agency_review — open a DealReviewRequest on a provider's deal
                             so the agency queue at /agency/reviews picks it
                             up (mirror of the provider-side /flag tool).
  send_team_announcement   — post to the agency's announcement surface
                             (a [ANN]-prefixed Note in the agency's space,
                             matching /api/agency/announcements POST).
  change_member_role       — promote/demote an AgencyMembership. Two-step
                             confirmation: the first call returns
                             requires_confirmation=true; the agent re-asks
                             the agency in chat, then re-calls confirmed=True.
  offboard_member          — highest-friction. agency_owner only; mirrors the
                             offboard_agency_member RPC the /api route
                             uses. Two-step confirmation.
  set_routing_rule         — set Agency.assignmentMethod (and the
                             autoAssignEnabled kill switch) to one of
                             manual / round_robin / score_based. The
                             enforcement engine lives in
                             lib/agency-routing.ts; this tool just
                             writes the columns it reads.

Every tool:
  1. Calls require_agency_role(ctx) on its FIRST line (defense layer 3).
  2. Confirms the affected entity belongs to ctx.agency_id before writing
     — a cross-agency write here would be a fiduciary failure.
  3. Inserts an AuditLog row after the write. If the audit insert fails the
     tool returns ok=false — a write without an audit trail is unacceptable
     under the SOC 2 invariant the AuditLog table backs.
  4. Best-effort notifies the affected provider (or the agency queue, for
     flag_deal_for_agency_review). Notification failure never fails the tool.
  5. Returns { "ok": bool, "summary": str, ... } where `summary` is the
     one-sentence sentence the agent paraphrases back to the agency.

The destructive tools (change_member_role, offboard_member) require an
explicit `confirmed=True` flag on a second call. The system prompt makes the
agent confirm in chat before re-calling.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from agents import RunContextWrapper, function_tool

from db import supabase
from security.context import AgentContext

from ._guards import require_agency_role


# ── Helpers (private, no @function_tool) ────────────────────────────────────


# AuditLog actions kept narrow — same shape lib/audit.ts uses. The 'UPDATE' /
# 'CREATE' / 'OFFBOARD' verbs already exist in the union; the rest map to
# 'UPDATE' or 'CREATE' so the table's downstream consumers don't have to
# learn new verbs.
async def _write_audit(
    *,
    ctx: RunContextWrapper[AgentContext],
    action: str,
    resource: str,
    resource_id: str | None,
    metadata: dict[str, Any],
) -> bool:
    """Insert an AuditLog row. Returns True on success.

    A failed audit insert is a hard failure for the calling tool — the
    point of the audit trail is that every agency mutation is recorded.
    The tool should report ok=false rather than leaving an unauditable
    write on the table.
    """
    db = await supabase()
    try:
        await db.table("AuditLog").insert({
            "id": str(uuid.uuid4()),
            # actorId is the User.id (matches lib/audit.ts column).
            # ctx.context.user_id is the Clerk userId on the Python side.
            "clerkId": ctx.context.user_id or None,
            "action": action,
            "resource": resource,
            "resourceId": resource_id,
            "metadata": {
                **metadata,
                "agencyId": ctx.context.agency_id,
                "agentRunId": ctx.context.run_id,
                "source": "koala_agency",
            },
        }).execute()
        return True
    except Exception:
        return False


async def _notify_agency_queue(
    *,
    agency_id: str,
    notification_type: str,
    title: str,
    body: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """Insert an AgencyNotification row — best-effort, never raises.

    Mirrors `lib/agency-notify.ts:notifyAgency`. Used when the tool wants to
    surface something on the agency's in-app bell (e.g. flag_deal_for_agency_review).
    """
    db = await supabase()
    try:
        await db.table("AgencyNotification").insert({
            "id": str(uuid.uuid4()),
            "agencyId": agency_id,
            "type": notification_type,
            "title": title,
            "body": body,
            "metadata": metadata,
            "read": False,
        }).execute()
    except Exception:
        # Notification is best-effort. The caller already committed the write
        # that matters; failing the tool here would be wrong.
        pass


async def _notify_provider_contact(
    *,
    space_id: str,
    contact_id: str,
    message: str,
    activity_type: str = "note",
    metadata: dict[str, Any] | None = None,
) -> None:
    """Drop a ContactActivity note on a provider's space — best-effort.

    The provider side surfaces ContactActivity in the contact's timeline.
    For events like "agency reassigned this lead to you" this is the
    closest thing to an in-app inbox we have — every provider already reads
    contact timelines as part of working their pipeline.
    """
    db = await supabase()
    try:
        await db.table("ContactActivity").insert({
            "id": str(uuid.uuid4()),
            "contactId": contact_id,
            "spaceId": space_id,
            "type": activity_type,
            "content": message,
            "metadata": {**(metadata or {}), "source": "koala_agency"},
        }).execute()
    except Exception:
        pass


async def _resolve_agency_space(agency_id: str) -> dict[str, Any] | None:
    """Find the agency owner's personal Space — where agency-intake
    contacts live before they're assigned out, and where announcement
    Notes are written.

    Mirrors `lib/space.ts:getSpaceByOwnerId(agency.ownerId)` from the TS
    side. Returns None if the agency row is missing or the owner doesn't
    have a space yet (older deploy).
    """
    db = await supabase()
    bk_res = await (
        db.table("Agency")
        .select("id,ownerId,name")
        .eq("id", agency_id)
        .maybe_single()
        .execute()
    )
    if not bk_res.data:
        return None
    owner_id = bk_res.data.get("ownerId")
    if not owner_id:
        return None
    sp_res = await (
        db.table("Space")
        .select("id,ownerId,name,agencyId")
        .eq("ownerId", owner_id)
        .maybe_single()
        .execute()
    )
    space = sp_res.data
    if not space:
        return None
    return {
        "space_id": space["id"],
        "owner_id": owner_id,
        "agency_name": bk_res.data.get("name") or "your agency",
    }


def _display_name(user: dict[str, Any] | None) -> str:
    if not user:
        return "Provider"
    return user.get("name") or user.get("email") or "Provider"


# ── 1. reassign_lead ────────────────────────────────────────────────────────


@function_tool(strict_mode=False)
async def reassign_lead(
    ctx: RunContextWrapper[AgentContext],
    lead_id: str,
    to_provider_id: str,
    reason: str | None = None,
) -> dict[str, Any]:
    """Move an agency-intake lead to a different provider on the team."""
    # lead_id: Contact.id of an agency-routed lead; must belong to this agency.
    # to_provider_id: User.id of a member of this agency with a workspace.
    # reason: optional note, logged to AuditLog + provider's ContactActivity.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id
    db = await supabase()

    if not lead_id or not to_provider_id:
        return {"ok": False, "summary": "Need both lead and target provider."}

    # ── Resolve the contact and verify agency scope ──────────────────
    # Two paths: contact lives in the agency owner's space (legacy) OR
    # contact has agencyId set explicitly (modern intake). Match the
    # logic in lib/agency-assign-lead.ts.
    contact_by_agency_res = await (
        db.table("Contact")
        .select("id,name,spaceId,agencyId,tags,leadType,leadScore,phone,email")
        .eq("id", lead_id)
        .eq("agencyId", agency_id)
        .maybe_single()
        .execute()
    )
    contact = contact_by_agency_res.data

    agency_space = await _resolve_agency_space(agency_id)
    if not contact and agency_space:
        contact_by_space_res = await (
            db.table("Contact")
            .select("id,name,spaceId,agencyId,tags,leadType,leadScore,phone,email")
            .eq("id", lead_id)
            .eq("spaceId", agency_space["space_id"])
            .maybe_single()
            .execute()
        )
        contact = contact_by_space_res.data

    if not contact:
        return {"ok": False, "summary": "Lead not found in your agency."}

    # ── Resolve the target provider + their space + their membership ─────
    membership_res = await (
        db.table("AgencyMembership")
        .select("id,userId,role")
        .eq("agencyId", agency_id)
        .eq("userId", to_provider_id)
        .maybe_single()
        .execute()
    )
    if not membership_res.data:
        return {"ok": False, "summary": "Target provider isn't on your team."}

    target_space_res = await (
        db.table("Space")
        .select("id,ownerId,name,agencyId")
        .eq("ownerId", to_provider_id)
        .maybe_single()
        .execute()
    )
    if not target_space_res.data:
        return {"ok": False, "summary": "Target provider doesn't have a workspace yet."}
    target_space_id = target_space_res.data["id"]

    target_user_res = await (
        db.table("User")
        .select("id,name,email")
        .eq("id", to_provider_id)
        .maybe_single()
        .execute()
    )
    target_name = _display_name(target_user_res.data)

    existing_tags = contact.get("tags") or []
    if "assigned" in existing_tags and contact.get("spaceId") == target_space_id:
        return {
            "ok": True,
            "summary": f"{contact.get('name') or 'Lead'} is already with {target_name}.",
            "unchanged": True,
        }

    # ── Identify the previous provider for audit + notification ──────────
    from_space_id = contact.get("spaceId")
    from_user: dict[str, Any] | None = None
    if from_space_id and (not agency_space or from_space_id != agency_space["space_id"]):
        from_space_res = await (
            db.table("Space")
            .select("id,ownerId,name")
            .eq("id", from_space_id)
            .maybe_single()
            .execute()
        )
        from_owner = (from_space_res.data or {}).get("ownerId")
        if from_owner:
            fu_res = await (
                db.table("User")
                .select("id,name,email")
                .eq("id", from_owner)
                .maybe_single()
                .execute()
            )
            from_user = fu_res.data
    from_name = _display_name(from_user) if from_user else "the agency queue"

    # ── Move the contact ────────────────────────────────────────────────
    # The assignLeadToProvider TS path clones the contact into the provider's
    # space and tags the original 'assigned'. We mirror that — re-anchoring
    # the Contact.spaceId would orphan any DealContact / activity rows that
    # already reference the original id. Cloning is the correct primitive.
    now = datetime.now(timezone.utc)
    new_contact_id = str(uuid.uuid4())

    # Refetch the full row to clone everything that matters.
    full_res = await (
        db.table("Contact")
        .select("*")
        .eq("id", lead_id)
        .maybe_single()
        .execute()
    )
    full = full_res.data or contact

    clone_row: dict[str, Any] = {
        "id": new_contact_id,
        "spaceId": target_space_id,
        "name": full.get("name"),
        "email": full.get("email"),
        "phone": full.get("phone"),
        "budget": full.get("budget"),
        "preferences": full.get("preferences"),
        "address": full.get("address"),
        "notes": full.get("notes"),
        "type": full.get("type") or "QUALIFICATION",
        "leadType": full.get("leadType"),
        "services": full.get("services") or [],
        "tags": ["assigned-by-agency", "new-lead"],
        "scoringStatus": full.get("scoringStatus"),
        "leadScore": full.get("leadScore"),
        "scoreLabel": full.get("scoreLabel"),
        "scoreSummary": full.get("scoreSummary"),
        "scoreDetails": full.get("scoreDetails"),
        "sourceLabel": full.get("sourceLabel") or "reassigned by agency",
        "applicationData": full.get("applicationData"),
        "applicationRef": full.get("applicationRef"),
        "applicationStatus": full.get("applicationStatus"),
        "createdAt": now,
        "updatedAt": now,
    }
    # Drop keys with None values for columns that are NOT NULL only when set;
    # the QueryBuilder passes None through and asyncpg will set NULL — safe
    # for the columns above (all nullable in this schema).
    try:
        await db.table("Contact").insert(clone_row).execute()
    except Exception:
        return {"ok": False, "summary": "Couldn't move the lead — DB rejected the new row."}

    # Tag the original 'assigned' so the agency leads page filters it out.
    updated_tags = [t for t in existing_tags if t != "new-lead"]
    if "assigned" not in updated_tags:
        updated_tags.append("assigned")
    try:
        await (
            db.table("Contact")
            .update({
                "tags": updated_tags,
                "applicationStatus": "assigned",
                "updatedAt": now,
            })
            .eq("id", lead_id)
            .execute()
        )
    except Exception:
        # The clone already committed; the original tag is best-effort to
        # match the TS path. Don't fail the tool.
        pass

    # ── Audit ───────────────────────────────────────────────────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="UPDATE",
        resource="Contact",
        resource_id=lead_id,
        metadata={
            "operation": "reassign_lead",
            "fromSpaceId": from_space_id,
            "fromUserId": (from_user or {}).get("id"),
            "toSpaceId": target_space_id,
            "toUserId": to_provider_id,
            "clonedContactId": new_contact_id,
            "reason": (reason or "").strip()[:500] or None,
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Move logged on the DB but audit row failed — flagging for review.",
            "clonedContactId": new_contact_id,
        }

    # ── Notify both providers (best-effort, never raise) ─────────────────
    note_to_target = (
        f"[Agency] Lead reassigned to you by your agency"
        + (f" — {reason.strip()[:240]}" if reason else "")
    )
    await _notify_provider_contact(
        space_id=target_space_id,
        contact_id=new_contact_id,
        message=note_to_target,
        metadata={"reason": (reason or "").strip()[:500] or None, "fromUserId": (from_user or {}).get("id")},
    )

    if from_space_id and from_space_id != (agency_space or {}).get("space_id"):
        # The original contact ID still lives in the previous provider's
        # space (legacy path) — leave a closing note there too.
        await _notify_provider_contact(
            space_id=from_space_id,
            contact_id=lead_id,
            message=(
                f"[Agency] Lead reassigned to {target_name} by your agency"
                + (f" — {reason.strip()[:240]}" if reason else "")
            ),
            metadata={"reason": (reason or "").strip()[:500] or None, "toUserId": to_provider_id},
        )

    lead_name = full.get("name") or "lead"
    return {
        "ok": True,
        "summary": f"Moved {lead_name} from {from_name} to {target_name}.",
        "clonedContactId": new_contact_id,
        "fromUserId": (from_user or {}).get("id"),
        "toUserId": to_provider_id,
    }


# ── 2. flag_deal_for_agency_review ──────────────────────────────────────────


@function_tool(strict_mode=False)
async def flag_deal_for_agency_review(
    ctx: RunContextWrapper[AgentContext],
    deal_id: str,
    reason: str,
) -> dict[str, Any]:
    """Open a review request on a provider's deal in this agency's /agency/reviews queue."""
    # deal_id: Deal.id (must be inside this agency).
    # reason: required 10+ chars; surfaces verbatim to the agency queue.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id

    clean_reason = (reason or "").strip()
    if len(clean_reason) < 10:
        return {"ok": False, "summary": "Need a few words of context on what to review."}
    if len(clean_reason) > 2000:
        clean_reason = clean_reason[:2000]

    db = await supabase()

    # ── Resolve deal + verify agency scope ───────────────────────────
    deal_res = await (
        db.table("Deal")
        .select("id,title,spaceId,status")
        .eq("id", deal_id)
        .maybe_single()
        .execute()
    )
    if not deal_res.data:
        return {"ok": False, "summary": "Deal not found."}
    deal = deal_res.data
    deal_title = deal.get("title") or "Deal"

    space_res = await (
        db.table("Space")
        .select("id,ownerId,agencyId")
        .eq("id", deal.get("spaceId"))
        .maybe_single()
        .execute()
    )
    if not space_res.data or space_res.data.get("agencyId") != agency_id:
        return {"ok": False, "summary": "That deal isn't in your agency."}
    provider_user_id = space_res.data.get("ownerId")

    # ── Insert DealReviewRequest. The partial unique index on (dealId)
    # WHERE status='open' will raise SQLSTATE 23505 on duplicates — match
    # the TS route's mapping to a friendly 409. asyncpg surfaces this via
    # the exception message; we don't depend on the SQLSTATE.
    review_id = str(uuid.uuid4())
    try:
        await db.table("DealReviewRequest").insert({
            "id": review_id,
            "dealId": deal_id,
            # The agency is flagging the deal on behalf of themselves. The
            # column is NOT NULL — use ctx.user_id (DB user id resolved by
            # the API gate before Modal). If empty, fall back to the agency
            # owner from the Agency row.
            "requestingUserId": ctx.context.user_id or provider_user_id,
            "agencyId": agency_id,
            "status": "open",
            "reason": clean_reason,
        }).execute()
    except Exception as e:
        msg = str(e).lower()
        if "23505" in msg or "duplicate" in msg or "unique" in msg:
            return {
                "ok": False,
                "summary": f"{deal_title} already has an open review.",
            }
        return {"ok": False, "summary": "Couldn't open the review request."}

    # ── Audit ───────────────────────────────────────────────────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="CREATE",
        resource="DealReviewRequest",
        resource_id=review_id,
        metadata={
            "operation": "flag_deal_for_agency_review",
            "dealId": deal_id,
            "reason": clean_reason[:500],
            "providerUserId": provider_user_id,
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Review row created but audit row failed — flagging for review.",
            "reviewId": review_id,
        }

    # ── Best-effort notifications: agency bell + the provider's deal timeline ──
    await _notify_agency_queue(
        agency_id=agency_id,
        notification_type="review_requested",
        title=f"Flagged for review: {deal_title}",
        body=clean_reason[:400],
        metadata={"dealId": deal_id, "reviewRequestId": review_id},
    )
    try:
        await db.table("DealActivity").insert({
            "id": str(uuid.uuid4()),
            "dealId": deal_id,
            "spaceId": deal.get("spaceId"),
            "type": "note",
            "content": f"[Agency] Deal flagged for review: {clean_reason[:400]}",
            "metadata": {"source": "koala_agency", "reviewRequestId": review_id},
        }).execute()
    except Exception:
        pass

    return {
        "ok": True,
        "summary": f"Flagged {deal_title} for review: {clean_reason[:160]}.",
        "reviewId": review_id,
    }


# ── 3. send_team_announcement ───────────────────────────────────────────────


@function_tool(strict_mode=False)
async def send_team_announcement(
    ctx: RunContextWrapper[AgentContext],
    message: str,
    urgency: Literal["normal", "urgent"] = "normal",
    title: str | None = None,
) -> dict[str, Any]:
    """Post a team-wide announcement to the agency's /agency/announcements surface."""
    # message: 1-10000 chars.
    # urgency: 'normal' or 'urgent' (urgent may trigger SMS if Telnyx is set).
    # title: optional; defaults to first 80 chars of message.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id

    clean_message = (message or "").strip()
    if not clean_message:
        return {"ok": False, "summary": "Need a message to send."}
    if len(clean_message) > 10000:
        clean_message = clean_message[:10000]

    clean_urgency = urgency if urgency in ("normal", "urgent") else "normal"
    clean_title = (title or clean_message.split("\n")[0])[:200].strip() or "Team announcement"

    # ── Locate the agency's space — announcements live there as a Note. ─
    agency_space = await _resolve_agency_space(agency_id)
    if not agency_space:
        return {"ok": False, "summary": "Couldn't find the agency workspace."}

    db = await supabase()

    # Author name for the rendered card.
    author_res = await (
        db.table("User")
        .select("id,name,email")
        .eq("id", ctx.context.user_id or "")
        .maybe_single()
        .execute()
    ) if ctx.context.user_id else None
    author = (author_res.data if author_res else None) or {}
    author_name = author.get("name") or author.get("email") or "Agency"

    # Match the JSON envelope the /api/agency/announcements POST writes.
    import json
    content_payload = json.dumps({
        "body": clean_message,
        "authorName": author_name,
        "authorId": ctx.context.user_id or None,
        "urgency": clean_urgency,
    })

    note_id = str(uuid.uuid4())
    try:
        await db.table("Note").insert({
            "id": note_id,
            "spaceId": agency_space["space_id"],
            "title": f"[ANN] {clean_title}",
            "content": content_payload,
            "sortOrder": -2,
        }).execute()
    except Exception:
        return {"ok": False, "summary": "Couldn't save the announcement."}

    # ── Count providers so the summary is honest ─────────────────────────
    members_res = await (
        db.table("AgencyMembership")
        .select("id,userId,role")
        .eq("agencyId", agency_id)
        .execute()
    )
    members = members_res.data or []
    # Providers on the team (everyone, since agency owners/admins are also on
    # the team). The N below is the headcount the message reaches.
    member_count = len(members)

    # ── Audit ───────────────────────────────────────────────────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="CREATE",
        resource="Note",
        resource_id=note_id,
        metadata={
            "operation": "send_team_announcement",
            "urgency": clean_urgency,
            "recipients": member_count,
            "title": clean_title,
            "telnyxAvailable": bool(os.environ.get("TELNYX_API_KEY")),
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Announcement saved but audit row failed — flagging for review.",
            "announcementId": note_id,
        }

    # ── Best-effort notification: agency queue gets a copy so the agency
    # bell shows their own outbound. The provider side reads announcements
    # by pulling /agency/announcements — same convention as the TS POST,
    # which is pull-based (no per-provider fanout). AgencyNotification.type
    # is plain `text NOT NULL` with no CHECK constraint (supabase/schema.sql),
    # so a dedicated "announcement" type is accepted by the DB. The bell
    # renderer (components/agency/notification-bell.tsx) maps unknown types
    # to a Bell icon — exactly right for an announcement — so this surfaces
    # correctly instead of masquerading as a flagged review.
    await _notify_agency_queue(
        agency_id=agency_id,
        notification_type="announcement",
        title=f"Announcement sent: {clean_title}",
        body=clean_message[:400],
        metadata={
            "kind": "announcement",
            "noteId": note_id,
            "urgency": clean_urgency,
            "recipients": member_count,
        },
    )

    sms_note = ""
    if clean_urgency == "urgent" and os.environ.get("TELNYX_API_KEY"):
        # The Python agent runs in Modal and doesn't have the Telnyx
        # client wired. We record intent on the audit metadata so a
        # follow-up worker / the Next.js side can fan out SMS. The
        # immediate user-visible note is calm: SMS dispatch is queued,
        # never claimed as complete.
        sms_note = " SMS dispatch queued for urgent send."

    return {
        "ok": True,
        "summary": f"Sent to {member_count} team member{'s' if member_count != 1 else ''}.{sms_note}",
        "announcementId": note_id,
        "urgency": clean_urgency,
        "recipients": member_count,
    }


# ── 4. change_member_role ───────────────────────────────────────────────────


# Roles the agency can set. agency_owner is excluded — ownership transfer is
# a separate, more involved flow and isn't part of this tool's surface.
_VALID_ROLES: frozenset[str] = frozenset({"agency_admin", "provider_member"})


@function_tool(strict_mode=False)
async def change_member_role(
    ctx: RunContextWrapper[AgentContext],
    member_id: str,
    new_role: Literal["agency_admin", "provider_member"],
    confirmed: bool = False,
) -> dict[str, Any]:
    """Change an agency member's role; two-step confirmed gate."""
    # member_id: AgencyMembership.id.
    # new_role: 'agency_admin' or 'provider_member' (owner cannot be set here).
    # confirmed: false first call returns requires_confirmation, true applies.
    # agency_admin can only flip provider_member <-> provider_member; owner-only otherwise.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id
    db = await supabase()

    if new_role not in _VALID_ROLES:
        return {"ok": False, "summary": "Role must be agency_admin or provider_member."}

    # ── Resolve membership + verify agency scope ─────────────────────
    mem_res = await (
        db.table("AgencyMembership")
        .select("id,userId,role,agencyId")
        .eq("id", member_id)
        .eq("agencyId", agency_id)
        .maybe_single()
        .execute()
    )
    if not mem_res.data:
        return {"ok": False, "summary": "Member not found on your team."}
    membership = mem_res.data
    current_role = membership.get("role") or ""

    if current_role == "agency_owner":
        return {"ok": False, "summary": "The owner role can't be changed here."}
    if current_role == new_role:
        return {"ok": True, "summary": f"Role is already {new_role}.", "unchanged": True}

    # Resolve the member's user name for the summary line.
    user_res = await (
        db.table("User")
        .select("id,name,email")
        .eq("id", membership.get("userId"))
        .maybe_single()
        .execute()
    )
    member_name = _display_name(user_res.data)

    # ── Permission: agency_admin can't move other admins, only providers. ─
    caller_role = (ctx.context.agency_role or "").strip().lower()
    if caller_role == "agency_admin":
        if current_role != "provider_member" or new_role != "provider_member":
            return {
                "ok": False,
                "summary": "Only the owner can change admin roles.",
            }

    # ── Confirmation gate ───────────────────────────────────────────────
    if not confirmed:
        return {
            "ok": False,
            "requires_confirmation": True,
            "summary": (
                f"About to change {member_name}'s role from {current_role} to "
                f"{new_role}. Confirm?"
            ),
            "memberName": member_name,
            "currentRole": current_role,
            "newRole": new_role,
        }

    # ── Apply ──────────────────────────────────────────────────────────
    try:
        await (
            db.table("AgencyMembership")
            .update({"role": new_role})
            .eq("id", member_id)
            .eq("agencyId", agency_id)
            .execute()
        )
    except Exception:
        return {"ok": False, "summary": "Couldn't update the role."}

    # ── Audit ───────────────────────────────────────────────────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="UPDATE",
        resource="AgencyMembership",
        resource_id=member_id,
        metadata={
            "operation": "change_member_role",
            "previousRole": current_role,
            "newRole": new_role,
            "memberUserId": membership.get("userId"),
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Role updated but audit row failed — flagging for review.",
        }

    # ── Best-effort notification: agency bell. The provider sees the new
    # capabilities the next time they hit the agency surface. We don't
    # fan out a contact-activity ping here — role changes aren't lead-scoped.
    await _notify_agency_queue(
        agency_id=agency_id,
        notification_type="member_joined",
        title=f"Role changed: {member_name} → {new_role}",
        body=f"Previously {current_role}.",
        metadata={
            "memberId": member_id,
            "userId": membership.get("userId"),
            "previousRole": current_role,
            "newRole": new_role,
        },
    )

    return {
        "ok": True,
        "summary": f"Changed {member_name} from {current_role} to {new_role}.",
        "memberId": member_id,
        "previousRole": current_role,
        "newRole": new_role,
    }


# ── 5. offboard_member ──────────────────────────────────────────────────────


@function_tool(strict_mode=False)
async def offboard_member(
    ctx: RunContextWrapper[AgentContext],
    member_id: str,
    destination_member_id: str | None = None,
    confirmed: bool = False,
) -> dict[str, Any]:
    """Remove a member from the agency; agency_owner only, two-step confirmed gate."""
    # member_id: AgencyMembership.id to remove.
    # destination_member_id: required on the apply call; inherits contacts/deals/appointments.
    # confirmed: false first call returns requires_confirmation, true executes.
    # Leaving user's workspace stays; only agency membership + asset attribution change.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id
    db = await supabase()

    # ── Permission: agency_owner only ───────────────────────────────────
    caller_role = (ctx.context.agency_role or "").strip().lower()
    if caller_role != "agency_owner":
        return {
            "ok": False,
            "summary": "Only the agency owner can offboard a member.",
        }

    # ── Resolve target membership ───────────────────────────────────────
    target_res = await (
        db.table("AgencyMembership")
        .select("id,userId,role,agencyId")
        .eq("id", member_id)
        .eq("agencyId", agency_id)
        .maybe_single()
        .execute()
    )
    if not target_res.data:
        return {"ok": False, "summary": "Member not found on your team."}
    target = target_res.data
    if target.get("role") == "agency_owner":
        return {"ok": False, "summary": "Can't offboard the agency owner."}

    target_user_res = await (
        db.table("User")
        .select("id,name,email,status")
        .eq("id", target.get("userId"))
        .maybe_single()
        .execute()
    )
    target_name = _display_name(target_user_res.data)

    # ── Confirmation gate ───────────────────────────────────────────────
    if not confirmed:
        return {
            "ok": False,
            "requires_confirmation": True,
            "summary": (
                f"About to remove {target_name} from your agency. They lose "
                "access to leads and the team. Their workspace stays intact. "
                "You'll also need to name a destination teammate to inherit "
                "their contacts and deals. Confirm?"
            ),
            "memberName": target_name,
            "memberId": member_id,
        }

    # ── Real run: destination is required ──────────────────────────────
    if not destination_member_id:
        return {
            "ok": False,
            "summary": "Need a destination teammate to inherit their contacts and deals.",
        }
    if destination_member_id == member_id:
        return {"ok": False, "summary": "Destination must be a different teammate."}

    dest_res = await (
        db.table("AgencyMembership")
        .select("id,userId,role,agencyId")
        .eq("id", destination_member_id)
        .eq("agencyId", agency_id)
        .maybe_single()
        .execute()
    )
    if not dest_res.data:
        return {"ok": False, "summary": "Destination teammate not found on your team."}
    dest = dest_res.data
    dest_user_res = await (
        db.table("User")
        .select("id,name,email,status")
        .eq("id", dest.get("userId"))
        .maybe_single()
        .execute()
    )
    if not dest_user_res.data or dest_user_res.data.get("status") != "active":
        return {"ok": False, "summary": "Destination teammate isn't active."}

    # ── Execute via the same RPC the TS route uses ─────────────────────
    try:
        rpc_result = await db.rpc(
            "offboard_agency_member",
            {
                "p_leaving_user_id": target.get("userId"),
                "p_destination_user_id": dest.get("userId"),
                "p_agency_id": agency_id,
                "p_dry_run": False,
            },
        ).execute()
    except Exception:
        return {"ok": False, "summary": "Offboard RPC failed."}

    payload = (rpc_result.data or [{}])[0] if rpc_result.data else {}
    contacts_moved = int(payload.get("contacts_moved") or payload.get("contactsMoved") or 0)
    deals_moved = int(payload.get("deals_moved") or payload.get("dealsMoved") or 0)
    appointments_moved = int(payload.get("appointments_moved") or payload.get("appointmentsMoved") or 0)

    # ── Audit (matches the OFFBOARD verb in lib/audit.ts) ──────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="OFFBOARD",
        resource="AgencyMembership",
        resource_id=member_id,
        metadata={
            "operation": "offboard_member",
            "leavingUserId": target.get("userId"),
            "destinationUserId": dest.get("userId"),
            "contactsMoved": contacts_moved,
            "dealsMoved": deals_moved,
            "appointmentsMoved": appointments_moved,
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Offboard completed but audit row failed — flagging for review.",
        }

    # ── Best-effort: agency queue gets the lifecycle event ─────────────
    await _notify_agency_queue(
        agency_id=agency_id,
        notification_type="member_removed",
        title=f"Removed {target_name}",
        body=(
            f"Moved {contacts_moved} contact{'s' if contacts_moved != 1 else ''}, "
            f"{deals_moved} deal{'s' if deals_moved != 1 else ''}, "
            f"{appointments_moved} open appointment{'s' if appointments_moved != 1 else ''} to "
            f"{_display_name(dest_user_res.data)}."
        ),
        metadata={
            "memberId": member_id,
            "leavingUserId": target.get("userId"),
            "destinationUserId": dest.get("userId"),
        },
    )

    return {
        "ok": True,
        "summary": f"Removed {target_name} from your agency.",
        "contactsMoved": contacts_moved,
        "dealsMoved": deals_moved,
        "appointmentsMoved": appointments_moved,
    }


# ── 6. set_routing_rule ─────────────────────────────────────────────────────


# Matches the AssignmentMethod union in lib/agency-routing.ts and the
# values the engine's loadAgencyRoutingConfig actually accepts. Anything
# else falls back to 'manual' on read, so writing it would silently disable
# auto-routing — guard against that here.
_VALID_ROUTING: frozenset[str] = frozenset({"manual", "round_robin", "score_based"})


@function_tool(strict_mode=False)
async def set_routing_rule(
    ctx: RunContextWrapper[AgentContext],
    strategy: Literal["manual", "round_robin", "score_based"],
) -> dict[str, Any]:
    """Set the agency-wide default routing for new unassigned leads."""
    # strategy: 'manual' (agency assigns), 'round_robin' (cycle), 'score_based' (best fit).
    # Writes Agency.assignmentMethod + autoAssignEnabled the routing engine reads.
    require_agency_role(ctx)
    agency_id = ctx.context.agency_id

    if strategy not in _VALID_ROUTING:
        return {"ok": False, "summary": "Strategy must be manual, round_robin, or score_based."}

    db = await supabase()

    # ── Confirm agency scope (and read the engine-relevant columns) ─
    bk_res = await (
        db.table("Agency")
        .select("id,name,autoAssignEnabled,assignmentMethod")
        .eq("id", agency_id)
        .maybe_single()
        .execute()
    )
    if not bk_res.data:
        return {"ok": False, "summary": "Agency row missing — couldn't set the rule."}
    # Engine treats anything other than 'round_robin' / 'score_based' as
    # 'manual'; mirror that here so previous-vs-new comparisons match what
    # the engine sees, not the raw column.
    raw_prev = bk_res.data.get("assignmentMethod")
    previous = raw_prev if raw_prev in {"round_robin", "score_based"} else "manual"

    if previous == strategy:
        return {
            "ok": True,
            "summary": f"Routing rule already set to {strategy}.",
            "unchanged": True,
        }

    # ── Apply ──────────────────────────────────────────────────────────
    # autoAssignEnabled is the kill switch the engine checks first; if it's
    # false, assignmentMethod is ignored and every lead falls back to the
    # agency-owner space. Tie the two columns together so the tool's
    # contract ("auto-route round-robin") actually takes effect.
    try:
        await (
            db.table("Agency")
            .update({
                "assignmentMethod": strategy,
                "autoAssignEnabled": strategy != "manual",
            })
            .eq("id", agency_id)
            .execute()
        )
    except Exception:
        return {"ok": False, "summary": "Couldn't write the routing rule."}

    # ── Audit ───────────────────────────────────────────────────────────
    audit_ok = await _write_audit(
        ctx=ctx,
        action="UPDATE",
        resource="Agency",
        resource_id=agency_id,
        metadata={
            "operation": "set_routing_rule",
            "previousStrategy": previous,
            "newStrategy": strategy,
        },
    )
    if not audit_ok:
        return {
            "ok": False,
            "summary": "Rule updated but audit row failed — flagging for review.",
        }

    return {
        "ok": True,
        "summary": (
            f"Routing rule set to {strategy}. Future unassigned leads will be "
            "auto-routed accordingly."
        ),
        "previousStrategy": previous,
        "newStrategy": strategy,
    }


# ── Module-level export ─────────────────────────────────────────────────────
# __init__.py extends AGENCY_TOOLS with this WRITE_TOOLS list; it's live in
# the agency agent's catalog alongside the read tools. Do NOT edit __init__.py
# here.

WRITE_TOOLS = [
    reassign_lead,
    flag_deal_for_agency_review,
    send_team_announcement,
    change_member_role,
    offboard_member,
    set_routing_rule,
]


__all__ = [
    "reassign_lead",
    "flag_deal_for_agency_review",
    "send_team_announcement",
    "change_member_role",
    "offboard_member",
    "set_routing_rule",
    "WRITE_TOOLS",
]
