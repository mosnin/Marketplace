# Koala

Professional-services marketplace and agentic operating system for providers and agencies.

---

## What is Koala?

Koala is two products in one:

1. **Marketplace front end** — Buyers browse service offerings at `/marketplace` and track their purchases at `/buyer` (powered by the `Purchase` table added in `supabase/migrations/20260611200000_buyer_marketplace.sql`).
2. **Agentic seller OS** — Each provider gets a workspace at `/s/[slug]` and each agency gets a console at `/agency`. The OS combines always-on AI agent workflows, client inquiry intake, AI scoring, deal pipeline management, appointment scheduling, and agency coordination into a single operational platform.

Koala serves the full professional-services category: hair stylists, personal trainers, coaches, photographers, tutors, consultants, and the studios, salons, and gyms that employ them.

### Key features

- **Marketplace & buyer purchase tracking** — Public service discovery at `/marketplace`; authenticated buyers track purchases and session history at `/buyer` via the `Purchase` table.
- **Public booking/inquiry forms** — Custom-branded intake pages for prospects to submit service inquiries or book sessions with a provider.
- **AI scoring of client inquiries** — Automatic lead qualification with a score, tier (hot/warm/cold), and plain-language summary so providers know where to focus first.
- **Deal pipeline for service sales** — Kanban-style deal management with customizable stages, drag-and-drop, and contact linking.
- **Appointment scheduling** — Public booking page, calendar integration, automated confirmations and reminders.
- **Agency console** — Multi-provider dashboards, invite system, performance tracking across all providers in a studio, salon, or gym.
- **AI agent** — Agent runtime with tool-use over the provider OS (read-only tools auto-run; mutating tools — email, SMS, deal/stage changes, appointments — require per-call user approval). Delegates research questions to read-only sub-agents so profile lookups don't bloat the orchestrator's context. See `lib/ai-tools/tools/index.ts` for the tool registry and `lib/ai-tools/skills/*` for the sub-agents.
- **Always-on background activation** — Incoming workspace events (new inquiry, deal stage change, session completed, booking submitted) are queued in Redis and immediately attempt a Modal webhook fire (`POST /api/agent/trigger`) so per-provider agents can react in near real-time with queue-based fallback if Modal is unavailable. Immediate fire policy is configurable with `AGENT_IMMEDIATE_EVENTS` (`all` by default, or comma-separated event names; invalid values fail safe to `all`).
- **Trigger operations runbook** — Operational endpoints, env vars, alerting, and replay workflow are documented in `docs/AGENT_TRIGGER_OPERATIONS.md`.
- **Agency tier** — Multi-provider organisation with per-seat billing: agency membership + role tiers (`agency_owner`, `agency_admin`, `provider_member`) in `lib/permissions.ts`; inquiry routing across providers (`lib/agency-routing.ts`); commission ledger (`lib/commissions.ts`); Stripe-backed seat subscriptions (`lib/agency-seats.ts`, `app/api/billing/*`).
- **Notifications** — Email (Resend) and SMS (Telnyx) notifications for inquiries, appointments, deals, and follow-ups.
- **Analytics** — Weekly trends, conversion funnels, and team performance metrics.

### Who it's for

- **Solo providers** (hair stylists, personal trainers, coaches, photographers, tutors, consultants) handling client inquiries and bookings.
- **Small teams and agencies** (studios, salons, gyms) managing multiple providers under one roof.
- **Agency-only users** overseeing team performance without running a personal provider workspace.
- **Buyers** browsing the marketplace and tracking their service purchases.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| UI | React 19, Tailwind CSS 4, shadcn/ui components |
| Auth | Clerk |
| Database | PostgreSQL via Supabase |
| AI | OpenAI (scoring + embeddings + assistant) |
| Vector search | Supabase pgvector |
| Email | Resend |
| SMS | Telnyx |
| Cache | Upstash Redis |
| Deployment | Vercel |

---

## Project structure

```
app/                    # Next.js App Router pages, layouts, API routes
  (auth)/               # Sign-in, sign-up, login pages
  marketplace/          # Public service discovery (buyer-facing browse)
  buyer/                # Authenticated buyer dashboard (purchase tracking)
  s/[slug]/             # Provider workspace (leads, contacts, deals, appointments, settings, AI)
  agency/               # Agency console (roster, routing, commissions, reviews)
  setup/                # Onboarding and workspace creation
  api/                  # API routes (contacts, deals, appointments, onboarding, AI, etc.)
components/             # UI and feature components
  ui/                   # Base shadcn/ui components
  dashboard/            # Dashboard widgets (header, sidebar, notification center)
  deals/                # Kanban board, deal forms
  agency/               # Agency-specific components
  auth/                 # Auth page layout, onboarding flow
lib/                    # Core business logic
  email.ts              # Resend email templates (inquiries, deals, invitations, digests)
  appointment-emails.ts # Appointment confirmation, reminder, follow-up emails
  sms.ts                # Telnyx SMS integration
  notify.ts             # Unified notification dispatcher (email + SMS)
  lead-scoring.ts       # AI inquiry scoring via OpenAI
  ai.ts                 # AI assistant with provider fallback
  supabase.ts           # Supabase client
  permissions.ts        # Auth helpers and agency context
supabase/
  schema.sql            # Database schema and migrations
docs/framework/         # Design system documentation (tokens, components, archetypes)
```

---

## Getting started

### Prerequisites

- Node.js 18+
- pnpm
- Supabase project (or PostgreSQL database)
- Clerk account for authentication

### Environment setup

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — Supabase connection
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` — Clerk auth
- `OPENAI_API_KEY` — Lead scoring and embeddings

Optional:
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — Email notifications
- `TELNYX_API_KEY` + `TELNYX_FROM_NUMBER` — SMS notifications
See [ENVIRONMENT.md](./ENVIRONMENT.md) for the full reference.

### Install and run

```bash
pnpm install
pnpm dev
```

### Database setup

1. Create a Supabase project
2. Enable the pgvector extension (Database > Extensions > search "vector")
3. Run `supabase/schema.sql` in the SQL editor

### Build for production

```bash
pnpm build
pnpm start
```

---

## Core workflows

1. **Provider signs up** via Clerk and completes onboarding (or skips to set up later)
2. **Workspace created** with a custom slug and public booking/inquiry link
3. **Clients submit** service inquiries or booking requests through the public intake form
4. **Inquiries are scored** automatically by AI and saved as contacts
5. **Provider manages** leads, contacts, deals, and appointments from the workspace dashboard
6. **Buyers browse** services at `/marketplace` and track purchases at `/buyer`
7. **Notifications sent** via email and/or SMS based on workspace preferences
8. **Agencies** can invite providers, track team performance, and manage the agency

---

## Environment reference

See [ENVIRONMENT.md](./ENVIRONMENT.md) for a detailed breakdown of all environment variables, services, and per-workspace configuration.

---

## Design system

The design system documentation lives in `docs/framework/` and covers:
- Design tokens (colors, spacing, typography, motion)
- Component specs (cards, tables, forms, modals, etc.)
- Screen archetypes (dashboard, analytics, table index, detail, settings)
- Dashboard archetypes (queue, pipeline, analytics, admin overview)
- Responsive breakpoints and mobile behavior

---

## License

Proprietary. All rights reserved.
