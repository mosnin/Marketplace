# 00 App Idea

## App Name

Koala

## One Sentence Product Definition

Koala is a professional-services marketplace and agentic OS for solo providers and agencies that turns a single intake link into qualified, AI-scored client inquiries with a clean pipeline for follow-up, sessions, and deals — plus a public marketplace where buyers browse and track purchases.

## Core User

- **Providers**: solo professionals in the U.S. (hair stylists, personal trainers, coaches, photographers, tutors, consultants) needing a fast lightweight way to capture and qualify client inquiries without enterprise CRM complexity.
- **Agencies**: studios, salons, gyms managing a roster of providers.
- **Buyers**: clients browsing service offerings at `/marketplace` and tracking their purchases at `/buyer`.

## Core Problem

Solo providers waste time switching between spreadsheets, email, social DMs, and generic CRMs to capture and qualify client inquiries. This leads to missed follow-ups, no lead prioritization, and poor pipeline visibility.

## Core Outcome

Providers go from sign-up to a live shareable intake link in under 5 minutes. Client inquiries flow in, get AI-scored with explainable context (hot/warm/cold + summary), and appear in a clean CRM where the provider can triage, follow up, schedule sessions, and track deals — all from one place.

## First Value Event

Provider generates their intake link and shares it. The first client inquiry arrives, is AI-scored, and appears in the leads view with a priority tier and plain-language summary.

## Main Product Workflow

Sign up → Create workspace → Generate intake link → Share link → Client submits inquiry → AI scores and triages lead → Provider reviews in leads view → Promotes to contact → Schedules session → Creates deal → Tracks through pipeline stages. Separately: buyers browse `/marketplace`, purchase a service, and track it at `/buyer`.

## Dashboard Definition

Summary stat cards: new applications (unread), total leads, clients in CRM, active deals (total value), upcoming appointments, follow-ups due. Below: intake link card (copy/preview), appointment booking link card, upcoming appointments list, follow-up widget, recent applications list (with score badges), and pipeline stage breakdown by count and value.

## Onboarding Definition

Multi-step inline onboarding flow triggered on first sign-in at `/`. Steps include: account type selection (provider vs agency), workspace creation (name + emoji), profile basics, and intake link setup. Agency-only users redirect to `/agency`. After completing onboarding, user lands in their workspace at `/s/[slug]`.

## Required Internal Modules

- Analytics (lead volume, conversion rates, pipeline value)
- AI Assistant (chat with RAG context over contacts and deals)
- Appointment scheduling (booking links, calendar management, availability)
- Activity Logs (contact and deal activity tracking)
- Notifications (agency notifications for agency members)

## Product Specific Features

- Marketplace and buyer purchase tracking: public service discovery at `/marketplace`, authenticated buyers track purchases at `/buyer`
- Shareable public intake/booking form (`/apply/[slug]`) for client inquiry or session booking
- AI inquiry scoring with explainable priority tiers (hot/warm/cold/unqualified) and plain-language summaries
- Leads view with score badges, new-lead indicators, and filtering
- Contact CRM with lifecycle types (QUALIFICATION, APPOINTMENT, APPLICATION), activity logs, follow-up scheduling
- Deal pipeline with Kanban board, drag-and-drop reordering, stages, values, and close dates
- Appointment scheduling with public booking pages (`/book/[slug]`), service profiles, buffer times, availability overrides, waitlist
- AI assistant (Chip) with conversation history and RAG over contacts/deals using vector embeddings
- Agency portal for agency owners/managers to oversee providers, send invitations, manage members
- Public application status page (`/apply/[slug]/status`)

## Product Specific Entities

- User (clerkId, email, name, platformRole, accountType, onboarding state)
- Space (slug, name, emoji, ownerId, agencyId)
- SpaceSetting (appointment config, intake page config, AI personalization, billing, timezone)
- Contact (name, email, phone, budget, preferences, type, tags, leadScore, scoreLabel, scoreSummary, scoreDetails, applicationData, followUpAt)
- Deal (title, value, address, priority, stageId, position, status, closeDate, sourceAppointmentId)
- DealStage (name, color, position per space)
- Appointment (guestName, guestEmail, startsAt, endsAt, status, serviceProfileId, manageToken)
- AppointmentServiceProfile (name, address, duration, hours, days, buffer)
- Conversation / Message (AI chat history per space)
- Agency (name, ownerId, status, joinCode)
- AgencyMembership (agencyId, userId, role)
- Invitation (agencyId, email, roleToAssign, token, status)
- DocumentEmbedding (vector embeddings for RAG)
- AuditLog, AgencyNotification, AppointmentAvailabilityOverride, AppointmentWaitlist

## Roles And Permissions

- **Platform Admin** (User.platformRole = 'admin'): Full access to `/admin` panel — user management, agency management, invitations, system overview.
- **Agency Owner** (AgencyMembership.role = 'agency_owner'): Owns an agency. Access to `/agency` portal — view providers, manage members, send invitations, agency settings.
- **Agency Manager** (AgencyMembership.role = 'agency_admin'): Same as agency owner but cannot delete agency.
- **Provider Member** (AgencyMembership.role = 'provider_member'): Member of an agency. Has their own workspace. Agency name shown in sidebar.
- **Provider (solo)** (default): Own workspace at `/s/[slug]`. Full access to their space — leads, contacts, deals, appointments, AI, analytics, settings, billing, profile.

## Integrations Or External Config

- Clerk (authentication, user management, session handling)
- Supabase (PostgreSQL database, RLS)
- OpenAI (lead scoring via gpt-4o-mini, embeddings via text-embedding-3-small, AI assistant)
- Resend (transactional email — appointment confirmations, waitlist notifications, agency notifications)
- Upstash Redis (rate limiting)
- Amplitude (product analytics)
- Vercel (hosting, speed insights)
- Google Calendar (appointment sync — OAuth tokens stored)

## Admin Requirements

- View all users with their account type, onboarding status, created date
- View individual user details and their space
- View all agencies with owner, status, member count
- View individual agency details and members
- Manage invitations across all agencies
- Platform admin access enforced at middleware level (Clerk publicMetadata.role or DB User.platformRole)

## V1 Scope

Auth (Clerk), multi-step onboarding, public intake form, AI lead scoring with explainable tiers, leads/contacts/deals CRM, Kanban deal pipeline, appointment scheduling with booking pages, AI assistant with RAG, agency portal, analytics dashboard, workspace settings, billing page, admin panel, marketing pages (pricing, features, FAQ, legal). All pages mobile responsive.

## Non Goals

- Multi-currency support
- MLS integration
- Document signing / transaction management
- Email/SMS campaign automation
- Service listing management
- Multi-user workspaces (one space per user currently)
- White-label branding
- Public API
- Team collaboration features beyond agency membership

## UX Constraints

- Setup to live intake link must complete in under 5 minutes
- Dashboard should load within 2 seconds
- AI scoring must produce explainable labels (not opaque numbers)
- Mobile must support full read/triage workflow (not just viewing)
- UI tone: modern, calm, product-first — not cluttered or enterprise-y

## Technical Constraints

- Clerk for auth (already integrated deeply)
- Supabase for database (service_role key bypasses RLS)
- Must deploy to Vercel
- No self-hosted infrastructure — all managed services
- OpenAI for lead scoring and embeddings (API key required)

## Success Criteria

- Provider goes from signup to live intake link in under 5 minutes
- Intake link generates application submissions consistently
- Lead scoring produces meaningful hot/warm/cold triage with explainable summaries
- Providers return to check and act on leads (retention signal)
- Appointment booking flow works end-to-end from public link to CRM
