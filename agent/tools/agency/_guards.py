"""Tool-runtime permission guard for agency tools (defense layer 3).

Three layers gate every agency-side action; this file is the last one:

  1. ROUTE GUARD     — `app/agency/koala/page.tsx` server component
                       redirects when the caller isn't a agency.
  2. API GATE        — `app/api/ai/agency-task/route.ts` re-runs
                       `resolveAgencyContext()` before posting to Modal.
  3. TOOL-RUNTIME    — this guard. Every agency tool MUST call it before
                       doing any work; a tool that skips it would execute
                       even if a misconfigured caller slipped past layers
                       1 and 2.

The contract is enforced at THIS layer because the agent runs inside a Modal
sandbox far away from the Next.js auth surface. Modal has only the context
the Next.js route hands it; if a future bug lets a non-agency context reach
here, the agency tools must still refuse.

Phase 2/3 tools wrap their handler body like this:

    @function_tool(strict_mode=False)
    async def some_agency_tool(ctx: RunContextWrapper[AgentContext], ...):
        require_agency_role(ctx)        # ← MUST come before any DB call
        # ... rest of the handler ...

`require_agency_role` raises `AgencyPermissionError` on refusal. The Agents
SDK serialises tool exceptions into model-visible tool outputs, so the model
sees a clear refusal and won't loop on the same tool — and the provider /
agency never sees raw DB state from a tool that shouldn't have run.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agents import RunContextWrapper

    from security.context import AgentContext


# Roles permitted to invoke agency tools. provider_member is excluded — they
# get the provider Koala at /s/<slug>/koala, not the agency chief-of-staff.
_AGENCY_ROLES: frozenset[str] = frozenset({"agency_owner", "agency_admin"})


class AgencyPermissionError(RuntimeError):
    """Raised when a agency tool runs without a agency-role caller.

    Distinct exception type so the agent runtime can log this category
    separately from generic tool errors — a permission-error spike means
    either a real attack attempt or a context-wiring bug, both worth alerting
    on.
    """


def require_agency_role(ctx: "RunContextWrapper[AgentContext]") -> None:
    """Refuse the call unless the AgentContext carries a agency role.

    Reads `ctx.context.agency_role` — populated by the Next.js agency-task
    route from `resolveAgencyContext()` and forwarded to Modal as part of
    the `chat_turn` request payload. Empty / unset / provider_member → refuse.

    Raises
    ------
    AgencyPermissionError
        When the caller is not `agency_owner` or `agency_admin`. The
        message intentionally omits the offending role to avoid leaking
        which roles exist; the agency just sees a flat refusal.
    """
    agent_ctx = ctx.context
    role = (getattr(agent_ctx, "agency_role", "") or "").strip().lower()
    if role not in _AGENCY_ROLES:
        raise AgencyPermissionError(
            "Agency tools are reserved for the agency's owner or admins."
        )


__all__ = ["AgencyPermissionError", "require_agency_role"]
