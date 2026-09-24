# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: the CTO or lead backend engineer at a seed–Series A startup (3–15 engineers, no dedicated SRE), who is also the on-call engineer. They are paged by Slack or PagerDuty — often after hours, often at 3am — and land in the dashboard to understand what broke, decide whether to trust SRE.ai's diagnosis, and approve, reject or roll back an action. Laptop first; the phone must be fully usable for approving or rolling back straight from a Slack link.

Secondary: a solo developer running a SaaS with production users, with no on-call rotation — just them, always.

## Product Purpose

SRE.ai is an AI Site Reliability Engineer. It ingests alerts (Prometheus, Grafana, Sentry, CloudWatch, generic webhooks), collects context (logs, metrics, deploys, dependency health, similar past incidents), produces a root-cause diagnosis, and acts through a confidence-gated action layer: auto-execute safe reversible actions, draft for approval, or escalate with a full context packet. Success is MTTR under 5 minutes for common incidents and engineers sleeping through the night.

## Positioning

Citation enforcement: every claim in a diagnosis must cite a verbatim line from the context the model actually saw, and a diagnosis that fails verification is capped at 35% confidence and escalated. SRE.ai only asserts what it can prove, and shows the proof. Actions are gated by that verified confidence, with one-click rollback.

## Operating Context

- Engineers arrive from a Slack message or PagerDuty page, usually mid-incident, under stress and possibly half-awake.
- Core loop: alert → incident (detecting → diagnosing → acting → resolved / escalated) → diagnosis with cited evidence and confidence → action (auto / draft approval / escalate) → resolution → post-mortem and runbook.
- Setup happens once, calmly, during onboarding: create an API key, point Alertmanager/Sentry/Grafana/CloudWatch at the webhook URL, connect Slack and PagerDuty, send a test alert.
- Real-time: incident status changes arrive over a websocket; the dashboard must reflect them without refresh.

## Capabilities and Constraints

- API (NestJS api-gateway, JSON envelope `{ success, data | error, traceId }`): auth (JWT 15 min + httpOnly refresh cookie), incidents (list/filter, detail, timeline, audit CSV, resolve, manual action, approve/reject, rollback), services (health, overrides: always-escalate, auto-execute opt-in, metadata), integrations (per-type config, secrets never returned, test button), API keys (show once, rotate with 24h grace, revoke), analytics (MTTR, severity trends, auto-resolve rate, recurring issues, confidence distribution, citation pass rate), runbooks, post-mortems, settings (thresholds, timezone, silence windows, digest), team.
- Roles: owner/admin can change configuration; members view and act on incidents.
- Confidence tiers: > 85% auto-execute, 60–85% draft for approval, < 60% escalate (tenant-overridable).
- Stack: Next.js 14 App Router (`apps/dashboard`), per the architecture decisions in CLAUDE.md.

## Brand Commitments

Name: SRE.ai. No logo, palette or typeface exists yet (confirmed); the dashboard establishes the first visual identity.

## Evidence on Hand

No customers, testimonials, benchmarks or real incident data exist yet. Any demonstration data must be clearly synthetic; never invent customer names, metrics or claims.

## Product Principles

1. Proof over persuasion: show the evidence behind every diagnosis; never let confidence look more certain than it is.
2. Calm under fire: the person reading is stressed and tired; the next decision must be obvious and one click away.
3. Humans stay in control: every automated action is visible, attributable and reversible where possible.
4. Setup in minutes: first real diagnosis within ten minutes of signup.

## Accessibility & Inclusion

WCAG 2.1 AA (confirmed): contrast, full keyboard operation, screen-reader labels, reduced-motion respected. Status must never be conveyed by colour alone.
