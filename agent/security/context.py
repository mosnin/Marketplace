"""AgentContext — runtime-injected security boundary.

spaceId is NEVER taken from LLM tool arguments. It is injected once when the
agent run starts and flows through every tool call via RunContextWrapper.
This prevents prompt-injection attacks from crossing tenant boundaries.

Autonomy is fixed: every contact-facing action drafts. There is no per-space
or per-agent override. Configuration is failure to decide.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from schemas import AgentSettings


@dataclass
class AgentContext:
    """Per-run context injected at orchestration time."""

    space_id: str
    space_name: str
    daily_token_budget: int
    run_id: str
    # Clerk userId for the provider this run is acting on behalf of.
    # Chat turns pass it from the request body; autonomous runs derive it
    # from the workspace owner via resolve_owner_user_id. Used by the
    # integration dispatcher tools to scope Composio calls to the right
    # entity. Empty string when no provider identity is available (older
    # Next.js deploy, or an autonomous run whose owner chain is broken) —
    # the dispatcher checks for this and degrades to "no integrations
    # available" rather than calling Composio with a bad id.
    user_id: str = field(default="", compare=False)

    # Tokens consumed so far this run (mutable — updated after each LLM call)
    tokens_used: int = field(default=0, compare=False)
    # Audit-log tag — fixed to "koala" since there is one agent. Tools read
    # this when stamping AgentActivityLog rows; keep the field so call sites
    # don't have to special-case the single-agent world.
    current_agent_type: str = field(default="koala", compare=False)

    # ── Agency-mode fields (Koala-for-Agencies) ──────────────────────────
    # Populated ONLY when the chat turn was initiated by a agency via
    # /api/ai/agency-task. Empty for every provider chat or autonomous run.
    # Read by `tools/agency/_guards.py:require_agency_role` (defense layer
    # 3) before any agency tool executes. Carrying these on AgentContext
    # — not as tool arguments — preserves the same invariant space_id has:
    # an identity claim from the LLM cannot escalate the run's scope.
    agency_id: str = field(default="", compare=False)
    # agency_role is the calling user's AgencyMembership.role at the
    # moment the API gate fired. Expected values: 'agency_owner',
    # 'agency_admin', or '' (not a agency). require_agency_role refuses
    # anything not in the first two.
    agency_role: str = field(default="", compare=False)

    # ── Trigger provenance (Composio trigger → autonomous run) ───────────
    # Set ONLY when the run was kicked by a Composio trigger delivery —
    # `dispatchTrigger` (TS) builds the object and threads it through the
    # Modal webhook body. The drafts tool reads this off context and
    # writes it to AgentDraft.triggerSource so the inbox UI can render
    # the "Koala noticed because..." breadcrumb. Empty dict on every
    # other run path (chat, routine, sweep, manual run-now).
    trigger_source: dict = field(default_factory=dict, compare=False)

    @classmethod
    def from_settings(
        cls,
        settings: AgentSettings,
        run_id: str,
        space_name: str,
        user_id: str = "",
        agency_id: str = "",
        agency_role: str = "",
        trigger_source: dict | None = None,
    ) -> "AgentContext":
        return cls(
            space_id=settings.space_id,
            space_name=space_name,
            daily_token_budget=settings.daily_token_budget,
            run_id=run_id,
            user_id=user_id,
            agency_id=agency_id,
            agency_role=agency_role,
            trigger_source=trigger_source or {},
        )

