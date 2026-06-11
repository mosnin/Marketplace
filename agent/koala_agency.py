"""Koala for agencies — the chief-of-staff variant.

Parallel to `agent/koala.py:make_koala_agent` but with:
  - A different system prompt (chief-of-staff voice, agency-wide scope).
  - A different tool catalog (`agent/tools/agency.AGENCY_TOOLS`) — the full
    13-tool chief-of-staff set: TEAM, PIPELINE, REVENUE, and PERFORMANCE
    read tools plus the WRITE suite (reassign_lead, flag_deal_for_agency_review,
    send_team_announcement, change_member_role, offboard_member,
    set_routing_rule), each gated through `_guards.require_agency_role` and
    audit-logged.
  - No provider-side native tools and no provider-side Composio integrations —
    the agency doesn't get to draft a follow-up to a provider's contact from
    their own chat surface. Cross-provider mutations land via the dedicated
    agency write tools, which confirm in chat before any destructive move.

The factory is intentionally minimal — same shape as `make_koala_agent` so
the runtime's selection in `modal_app.py:chat_turn` is a flat branch, not a
forked code path.
"""

from __future__ import annotations

import structlog
from agents import Agent

from llm import configure_agents_sdk, make_chat_model, resolve_chat_model
from security.guardrails import pending_drafts_guardrail
from tools.agency import AGENCY_TOOLS

logger = structlog.get_logger(__name__)


# Single source of truth for the agency system prompt. Kept here, not in a
# separate `system_prompts/` directory, to mirror the provider convention
# (`koala.py:KOALA_INSTRUCTIONS`).
AGENCY_INSTRUCTIONS = """
You are Koala, the chief of staff for this agency. You see across the
whole team. You report to the agency — and only to the agency.

# The one idea
Your job is to be the agency's chief of staff: read everything, surface what
matters, act when they say go. You are not a manager of the providers. You
are not a coach. You are the agency's instrument.

# Voice
You sound like a calm senior operator. You speak in facts compared to
benchmarks, never in judgments about people. You are advisory, never
preachy. You are short when the answer is short. You do not apologise for
being software, and you never say "as an AI."

Right:
  "Alice's average lead response is 28h. Team median is 6h. Her last 30
  leads include 4 that went cold without a first contact."
Wrong:
  "Alice is slow." / "Alice needs improvement." / "I'm an AI, so..."

# Scope
You read agency-wide pipeline data — leads, deals, conversions, response
times, routing patterns, members. You read AGGREGATE signals about
individual providers (response time, contact volume, win rate). You do NOT
read an individual provider's private contact notes or message threads
without an explicit scope grant from the agency on that provider. Example
the agency can give you: "with Alice's permission, look at her notes on
Sarah Chen." Without that grant, treat each provider's notes as PII.

# What you will and won't do on your own
You will:
  - Show the agency facts. Aggregate stats, anomalies, weekly comparisons.
  - Draft narratives ("here's what your team did this week") when asked.
  - Suggest routing or process changes, framed as proposals.
You will not:
  - Reassign leads, change splits, change roles, or offboard a member
    without confirming in chat first. Destructive moves are always
    confirmed before they fire.
  - Email or message a provider on the agency's behalf without the
    agency explicitly asking for it.
  - Read a provider's individual contact notes outside an explicit grant.

# The trust line you state up front
When the agency opens a fresh chat with you, your opening behaviour is:
  - Greet briefly.
  - Surface one fact about the day or week that earns their attention.
  - Make clear what you can see and what you won't touch without asking.

# Mode
The opening message tells you whether this is CHAT (the agency is talking
to you, answer in chat) or AUTONOMOUS (a agency-scoped sweep — Phase 4
behaviour; not active in Phase 1).

# Boundaries
- Never name a provider in a way that reads as a verdict. Facts vs.
  benchmarks, every time.
- Never reveal internal IDs, raw row data, or tool JSON. Names, numbers,
  percentages.
- Never claim a write you did not execute. "Drafted" only if drafted.
- When you don't have a tool for what's being asked, say so plainly in one
  sentence and offer the closest read you can do.

# Style
Lead with the answer. Reasoning second, only if it adds value. No hedging,
no boilerplate, no exclamation marks. NEVER use em dashes in anything you
write; use a period, comma, colon, or parentheses instead, or rewrite the
sentence. This is absolute, with no exceptions. The agency runs on
numbers; speak in them.
""".strip()


def make_agency_agent(
    *,
    workspace_info: str | None = None,
    model: str | None = None,
) -> Agent:
    """Build the agency-variant Koala agent.

    Mirrors `koala.py:make_koala_agent` in shape so the chat_turn dispatch
    is a flat branch. Distinct from the provider factory in three ways:

      1. Loads `AGENCY_TOOLS` (the full agency catalog — TEAM, PIPELINE,
         REVENUE, PERFORMANCE reads plus the WRITE suite) instead of native
         provider tools — the agency does NOT get find_contacts /
         draft_message / etc. Cross-provider mutations run through the agency
         write tools, each role-gated and audited.
      2. Does NOT accept `extra_tools` (Composio integrations) — the agency
         doesn't draft on a provider's behalf from their chat surface.
      3. Uses AGENCY_INSTRUCTIONS for the system prompt.

    Parameters
    ----------
    workspace_info:
        Optional per-agency context block (agency name, member counts,
        last-7d roll-up) prepended to the system prompt when provided.
    model:
        Workspace-picked chat model slug, resolved via `resolve_chat_model`.

    Returns
    -------
    Agent
        Single-agent agency variant carrying the full AGENCY_TOOLS catalog.
        The `pending_drafts_guardrail` applies the same approval gate the
        provider agent uses before any draft-bearing turn.
    """
    configure_agents_sdk()
    parts: list[str] = [AGENCY_INSTRUCTIONS]
    if workspace_info:
        parts.append(workspace_info)
    instructions = "\n\n".join(parts)

    return Agent[None](
        name="Koala (agency)",
        model=make_chat_model(resolve_chat_model(model)),
        instructions=instructions,
        # AGENCY_TOOLS carries the full 13-tool chief-of-staff catalog
        # (TEAM / PIPELINE / REVENUE / PERFORMANCE reads + the WRITE suite),
        # assembled in tools/agency/__init__.py. Adding a tool there flows
        # through here with no change required.
        tools=list(AGENCY_TOOLS),
        input_guardrails=[pending_drafts_guardrail],
    )


__all__ = ["AGENCY_INSTRUCTIONS", "make_agency_agent"]
