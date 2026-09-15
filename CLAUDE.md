# SRE.ai — CLAUDE.md

> This file is the single source of truth for Claude Code working on this project.
> Read this entire file before writing any code, making any architectural decision,
> or suggesting any change. Every decision here was made deliberately.

---

## Project Overview

**SRE.ai** is an AI-powered Site Reliability Engineer for small startups.
It monitors production systems, detects incidents, diagnoses root causes using
an LLM agent with citation enforcement, and resolves common issues autonomously
via a confidence-gated action layer.

**Core value prop:** Reduce MTTR from 30+ minutes to under 5 minutes — without
hiring a dedicated SRE.

**Builder:** Santosh Kumar — solo, full-time
**Stage:** Active development (see current phase below)
**Stack:** NestJS + TypeScript + PostgreSQL + pgvector + Redis + AWS SQS + BullMQ

---

## Monorepo Structure

```
sre-ai/
├── apps/
│   ├── api-gateway/          # Public API, auth, tenant management
│   ├── ingestion-service/    # Webhook receivers, deduplication, SQS enqueue
│   ├── diagnosis-service/    # Context collection, LLM agent, citation enforcement
│   ├── action-service/       # Confidence routing, auto-execute, rollback
│   └── dashboard/            # Next.js 14 frontend
├── packages/
│   ├── shared/               # DTOs, constants, types — shared across all apps
│   ├── database/             # TypeORM entities, migrations, base repository
│   └── queue/                # SQS + BullMQ abstractions
├── docker-compose.yml        # Local dev: postgres, redis, localstack
├── docker-compose.prod.yml   # Production compose
└── CLAUDE.md                 # This file
```

---

## Current Phase

> Update this section every time you start a new phase or complete a day.

**Current Phase:** Phase 0 — Foundation
**Current Day:** Day 1
**Status:** In progress

**Completed:**
- [ ] Monorepo scaffold
- [ ] PostgreSQL + pgvector + migrations
- [ ] JWT auth + multi-tenancy
- [ ] SQS + BullMQ setup
- [ ] Logging + error handling
- [ ] Docker + CI/CD

**Next task:** NestJS monorepo scaffold with 4 services

---

## Architecture Decisions — DO NOT CHANGE WITHOUT DISCUSSION

These decisions were made deliberately. Do not suggest alternatives unless
there is a critical production issue that cannot be solved within these constraints.

### Language & Framework
- **NestJS + TypeScript** for all backend services — not Go, not Fastify, not Express alone
- **Next.js 14 App Router** for dashboard — not Remix, not Vite, not CRA
- **pnpm workspaces** for monorepo — not Turborepo, not Nx, not Lerna

### Database
- **PostgreSQL** (RDS db.t3.micro on AWS) — not MongoDB, not MySQL
- **pgvector** for vector embeddings — not Pinecone, not Weaviate, not Chroma
- **TypeORM** with migrations — never use `synchronize: true` in any environment
- All queries must be tenant-scoped — `WHERE tenant_id = $tenantId` on every query

### Queue & Jobs
- **AWS SQS** for durable message passing between services
- **BullMQ** (Redis-backed) for in-process job queues and scheduled tasks
- **Never** process webhook payloads synchronously — always enqueue first, return 200
- DLQ configured on all SQS queues: maxReceiveCount = 3

### Caching & Real-time
- **Redis** for: deduplication windows, session cache, BullMQ backing, pub/sub
- **Socket.IO** with Redis adapter for dashboard real-time updates
- Deduplication key TTL: 300 seconds (5 minutes)

### LLM & Embeddings
- **GPT-4o** for diagnosis — not GPT-4-turbo, not Claude, not Gemini (for now)
- **text-embedding-3-small** for embeddings — 1536 dimensions, cost-effective
- Temperature: **0.1** on all diagnosis calls — factual, not creative
- Citation enforcement is non-negotiable — see Citation Enforcement section below

### Auth
- **JWT** with 15-minute access token + 7-day refresh token (httpOnly cookie)
- **API keys** for webhook endpoints — separate from JWT, stored hashed in DB
- Multi-tenancy: row-level isolation, every entity has `tenant_id` foreign key

### Deployment
- **AWS ECS Fargate** (or EC2 t2.micro on free tier) — not Vercel, not Railway
- **Docker** for all services — no bare metal deploys
- **GitHub Actions** for CI/CD — lint → test → build → deploy on push to main

---

## Non-Negotiable Code Rules

### 1. Never use `synchronize: true` in TypeORM
```typescript
// ❌ NEVER
TypeOrmModule.forRoot({ synchronize: true })

// ✅ ALWAYS
TypeOrmModule.forRoot({ synchronize: false, migrations: [...] })
```

### 2. Every webhook endpoint returns 200 immediately
```typescript
// ❌ NEVER — blocks the request
@Post('/webhooks/prometheus/:key')
async receive(@Body() body: any) {
  await this.diagnoseService.diagnose(body); // slow
  return { ok: true };
}

// ✅ ALWAYS — enqueue and return
@Post('/webhooks/prometheus/:key')
async receive(@Body() body: any) {
  await this.sqsService.enqueue(body); // fast
  return { ok: true }; // < 50ms
}
```

### 3. Every repository method is tenant-scoped
```typescript
// ❌ NEVER
findAll(): Promise<Incident[]> {
  return this.repo.find();
}

// ✅ ALWAYS
findAll(tenantId: string): Promise<Incident[]> {
  return this.repo.find({ where: { tenantId } });
}
```

### 4. Citation enforcement before any action
```typescript
// ❌ NEVER — act on unchecked LLM output
const diagnosis = await this.llmAgent.diagnose(context);
await this.actionService.execute(diagnosis);

// ✅ ALWAYS — validate citations first
const diagnosis = await this.llmAgent.diagnose(context);
const validation = await this.citationValidator.validate(diagnosis, context);
if (!validation.passed) diagnosis.confidence = Math.min(diagnosis.confidence, 0.35);
await this.actionService.execute(diagnosis); // now safe
```

### 5. Promise.allSettled for context collection — never Promise.all
```typescript
// ❌ NEVER — one collector failing kills the whole diagnosis
const [logs, metrics] = await Promise.all([
  this.logCollector.collect(incident),
  this.metricsCollector.collect(incident),
]);

// ✅ ALWAYS — partial context is better than no diagnosis
const [logs, metrics] = await Promise.allSettled([
  this.logCollector.collect(incident),
  this.metricsCollector.collect(incident),
]);
```

### 6. Structured logging — every log line has traceId + tenantId
```typescript
// ❌ NEVER
this.logger.log('Processing incident');

// ✅ ALWAYS
this.logger.log('Processing incident', {
  traceId: ctx.traceId,
  tenantId: ctx.tenantId,
  incidentId: incident.id,
  severity: incident.severity,
});
```

### 7. DTOs for everything — no raw `any` types on API boundaries
```typescript
// ❌ NEVER
@Post('/webhooks/prometheus')
async receive(@Body() body: any) {}

// ✅ ALWAYS
@Post('/webhooks/prometheus')
async receive(@Body() body: PrometheusWebhookDto) {}
```

---

## Citation Enforcement — The Core Safety Layer

This is the most important non-negotiable in the entire codebase.
The LLM diagnosis agent must never surface a claim it cannot prove from
retrieved context. This is what separates SRE.ai from a hallucination machine.

### How it works:
1. LLM is prompted to include `[SOURCE: <type>, <reference>]` after every claim
2. Validator checks each reference exists verbatim in the context passed to the LLM
3. If > 30% of citations are invalid → max confidence capped at 0.35 → escalate tier
4. All citation failures logged to `citation_failures` table for monitoring

### DiagnosisOutput schema — always validate with Zod:
```typescript
const DiagnosisOutputSchema = z.object({
  hypothesis: z.string().min(10).max(500),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    claim: z.string(),
    source: z.enum(['logs', 'metrics', 'deploy', 'dependency', 'similar_incident']),
    reference: z.string().min(3),
  })).min(1),
  recommended_action: z.string(),
  action_tier: z.enum(['auto', 'draft', 'escalate']),
  reasoning: z.string(),
});
```

---

## Confidence Thresholds

| Score | Tier | Action |
|-------|------|--------|
| > 0.85 | AUTO | Execute action immediately, log audit trail |
| 0.60 - 0.85 | DRAFT | Send Slack message with Approve/Reject buttons |
| < 0.60 | ESCALATE | PagerDuty + Slack with full context packet |

**Per-service override:** tenants can set `alwaysEscalate: true` on any service
(e.g. payment-service). This overrides confidence score entirely.

---

## Environment Variables

```bash
# Required — app will not start without these
DATABASE_URL=postgresql://sreai:password@localhost:5432/sreai
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
JWT_SECRET=<min 32 chars, random>
JWT_REFRESH_SECRET=<min 32 chars, different from JWT_SECRET>
ENCRYPTION_KEY=<32 bytes, hex — for encrypting integration credentials>

# AWS
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SQS_P1_QUEUE_URL=...
SQS_P2_QUEUE_URL=...
SQS_DLQ_URL=...
S3_BUCKET_NAME=sreai-postmortems

# Integrations (optional — features disabled if not set)
SLACK_BOT_TOKEN=xoxb-...
PAGERDUTY_API_KEY=...
GITHUB_APP_PRIVATE_KEY=...
SENTRY_DSN=...

# Local dev only
LOCALSTACK_ENDPOINT=http://localhost:4566
```

---

## Database Migrations

```bash
# Create a new migration
pnpm --filter @sreai/database migration:create -- MigrationName

# Run migrations
pnpm --filter @sreai/database migration:run

# Revert last migration
pnpm --filter @sreai/database migration:revert
```

**Migration rules:**
- Every schema change MUST be a migration file — never edit an existing migration
- Migration filenames: `{timestamp}_{PascalCaseName}.ts`
- Always write both `up()` and `down()` methods
- Test `down()` before committing — it must cleanly revert

---

## Testing Standards

```bash
# Run all tests
pnpm test

# Run tests for one service
pnpm --filter @sreai/diagnosis-service test

# Run e2e tests
pnpm test:e2e

# Coverage (minimum 70% required to merge)
pnpm test:cov
```

**What to test:**
- Unit: every service method, every edge case, every error path
- Integration: database queries with real PostgreSQL (use testcontainers)
- E2E: full incident lifecycle — alert → diagnosis → action → resolution
- Never mock the database in integration tests — use a real test DB

---

## SQS Queue Names

| Queue | Purpose | Priority |
|-------|---------|---------|
| `sreai-incidents-p1` | P1 (critical) alerts | Highest |
| `sreai-incidents-p2` | P2/P3 alerts | Normal |
| `sreai-incidents-dlq` | Failed after 3 retries | DLQ |

**Local dev:** Use LocalStack at `http://localhost:4566`
**Production:** Real AWS SQS in `ap-south-1`

---

## Incident Status Lifecycle

```
DETECTING → DIAGNOSING → ACTING → RESOLVED
                                ↘ ESCALATED
```

- `detecting` — alert received, incident created, enqueued for diagnosis
- `diagnosing` — diagnosis worker processing, context being collected
- `acting` — diagnosis complete, action being taken
- `resolved` — incident resolved (auto or manual), MTTR calculated
- `escalated` — low confidence or human intervention required

---

## Common Commands

```bash
# Start local dev stack
docker-compose up -d

# Start all services in watch mode
pnpm dev

# Start one service
pnpm --filter @sreai/ingestion-service dev

# Build all
pnpm build

# Lint
pnpm lint

# Format
pnpm format

# Generate TypeORM entity
nest g class incidents/entities/incident.entity --no-spec \
  --project database

# Create SQS queues in LocalStack
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name sreai-incidents-p1
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name sreai-incidents-p2
aws --endpoint-url=http://localhost:4566 sqs create-queue \
  --queue-name sreai-incidents-dlq
```

---

## What Claude Code Should Always Do

- Read this file at the start of every session
- Follow all Non-Negotiable Code Rules above — no exceptions
- Use TypeScript strict mode — no `any`, no `as unknown`
- Write the test alongside the implementation — not after
- Add structured logging to every service method that touches external I/O
- Check if a migration exists before suggesting a schema change
- Use existing DTOs in `packages/shared` before creating new ones
- Never suggest disabling TypeScript strict mode or ESLint rules

## What Claude Code Should Never Do

- Use `synchronize: true` in TypeORM config
- Process webhooks synchronously (must enqueue and return 200)
- Skip citation validation before routing to action layer
- Use `Promise.all` in context collection (use `Promise.allSettled`)
- Suggest switching the LLM provider mid-build without discussion
- Create a new package without checking if shared already covers it
- Commit secrets or API keys — always use environment variables
- Use `console.log` — always use the structured Winston logger
- Skip writing `down()` in migrations

---

## Development Workflow

Use gstack for workflow; this CLAUDE.md remains the source of truth
for all SRE.ai architecture and engineering constraints.

### Significant Features

* `/office-hours` — clarify significant/ambiguous product ideas
* `/plan-ceo-review` — challenge scope and MVP
* `/plan-eng-review` — validate architecture before coding
* Implement according to this CLAUDE.md
* `/review` — review implementation and security
* `/qa` — verify end-to-end behavior
* `/ship` — prepare for release

### Bugs

* `/investigate` — reproduce and identify root cause
* Implement smallest correct fix + regression test
* `/review`
* `/qa`

### High-Risk Changes

Use `/careful` before changes involving:

* authentication or tenant isolation
* database migrations
* automatic remediation/actions
* AWS infrastructure or queues
* citation enforcement
* confidence thresholds
* secrets/encryption

### Rule

gstack workflows must not override any architecture decision or
non-negotiable rule in this file.


## Helpful Context for Claude Code

- Builder has 2 years production NestJS + AWS experience
- Builder has shipped SQS pipelines (10k msgs/day), Socket.IO with Redis adapter,
  Razorpay payments, ECS Fargate CI/CD in production
- Familiar with: TypeORM, BullMQ, JWT, Passport.js, Docker, GitHub Actions
- Less familiar with: pgvector internals, LangGraph, advanced PostgreSQL tuning
- Preferred code style: explicit over implicit, verbose over clever
- When in doubt: ask before building — a 2-minute clarification beats 2 hours of rework
