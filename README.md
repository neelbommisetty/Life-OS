# Life-OS

## Overview

Life-OS is a single-user productivity workspace built as a Bun monorepo. It combines projects, tasks, notes, inbox capture, and AI conversations in one system, with a Next.js web app on top of a Hono API and shared AI, database, and logging packages.

The current implementation is technically centered on a clear web-to-API boundary, provider-routed AI services, server-sent event chat streaming, structured proposal workflows for inbox captures, and tracked AI usage data that feeds both analytics and pricing views.

## Core Capabilities

- Neon Auth-backed sign-in, sign-up, password reset, profile update, password change, and sign-out flows
- Home dashboard with recent projects, upcoming tasks, recent notes, and quick inbox capture
- Projects that group related assistant threads, tasks, notes, and per-project assistant instructions
- Kanban-style task management with search, status changes, soft-delete archive behavior, and project linkage
- Notes editing with autosave-oriented flows and assistant-message-to-note capture
- Inbox capture that queues AI-generated proposal outputs for notes and task lists
- Assistant chat with thread management, model selection, regenerate, streaming responses, and follow-on save actions
- AI usage analytics covering costs, token counts, call types, and recent model activity
- Registry-backed model pricing catalog sourced from the shared AI package

## Architecture

Life-OS is organized as a Bun workspace monorepo with two apps and three shared packages:

- `apps/web` is a Next.js 16 App Router frontend. It owns the UI, route metadata, and Next-internal proxy routes for auth passthrough and chat streaming.
- `apps/api` is a Hono API running on Bun. It exposes the canonical backend contracts for auth, status, home, projects, tasks, notes, inbox, chat, analytics, and inbox-agent settings.
- `packages/ai` contains provider adapters, model metadata, service routing, pricing snapshots, prompt-copy helpers, and AI call tracking utilities.
- `packages/db` contains the Prisma schema, migrations, and the shared Prisma/Neon runtime used by server-side workspaces.
- `packages/logger` provides shared logging primitives used across the apps and packages.

At runtime, the main data flow is:

1. The web app renders pages and triggers server/client data actions.
2. Auth and chat stream requests pass through Next route handlers where browser-facing proxy behavior is needed.
3. Business data requests go to the Hono API.
4. The API handles auth resolution, request IDs, validation, and error mapping before calling domain services.
5. Domain services use shared AI, DB, and logger packages for model execution, persistence, and observability.

The chat pipeline is split into a few layers:

- request parsing and auth resolution in `apps/api`
- thread lookup or creation, plus optional per-thread model overrides
- prompt assembly from a separate `ChatThreadContext` store
- context summarization when token budgets exceed the configured threshold
- model routing through shared AI service routes with retry and failover behavior
- SSE streaming back to the client with persisted assistant messages at the end of the stream

The inbox pipeline is similarly structured:

1. A freeform inbox item is captured and stored in `PROCESSING` state.
2. Proposal generation is queued against enabled inbox agents.
3. Agents return structured note or task-list payloads through JSON-schema-backed model calls.
4. Outputs are stored for review as proposal records.
5. Approval, decline, retry, skip, and bulk-resolution actions update those records with idempotency protection and can materialize notes or tasks.

## Technical Highlights

- Shared model registry with normalized metadata for provider, capabilities, cost tier, labels, and pricing
- Service-route layer in `packages/ai` that supports retry, failover, rotating strategies, and optional model overrides per thread
- SSE chat stream protocol with explicit `chunk`, `message_saved`, `done`, and `error` events
- Separate `ChatThreadContext` persistence layer that stores summarized and recent context independently from raw messages
- AI call tracking that records tokens, latency, streaming throughput, model attribution, retry attempts, and cost snapshots
- Typed request validation with Zod across route inputs and structured AI outputs
- Centralized error classification and consistent JSON error bodies in the API layer
- Request correlation and Sentry instrumentation in both the API and Next.js app
- Automated coverage across API routes, shared packages, web utilities, and Playwright end-to-end flows

## Tech Stack

- Bun
- TypeScript
- Next.js 16
- React 19
- Hono
- Prisma
- PostgreSQL with Neon
- Zod
- OpenAI SDK
- Anthropic SDK
- xAI SDK
- Sentry
- Playwright

## Getting Started

Install dependencies:

```bash
bun install
```

Configure environment variables using `.env.example` as the reference. The repo expects values for the database connection, Neon Auth base URL, AI provider keys, and API base URL variables used by the web app.

Start both apps from the repo root:

```bash
bun run dev:all
```

Useful commands:

```bash
bun run test
bun run test:web:e2e
bun run prisma:migrate
bun run commit:setup
```

Notes:

- `bun run dev:all` uses the root orchestration script and prepares shared runtime artifacts before starting the web and API services.
- `bun run test:web:e2e` is optional and runs the Playwright suite for the web app.
- `bun run commit:setup` installs the local Git hook and commit template configuration used by this repo. Commit format details live in `docs/commit-standard.md`.

## Project Structure

```text
apps/
  web/        Next.js App Router frontend
  api/        Hono API running on Bun

packages/
  ai/         Provider adapters, routing, pricing, prompts, tracking
  db/         Prisma schema, migrations, shared Prisma runtime
  logger/     Shared logger utilities

docs/         Product, design, workflow, and test-plan documentation
scripts/      Root development and Git setup scripts
```

## Current Status

- Active development
- Core product flows are implemented across the web app, API, Prisma schema, and shared AI package
- The repo includes broad automated coverage for route behavior, shared utilities, and critical web flows
- Deployment configuration in the repo is currently Vercel-specific for `apps/web` and `apps/api`
- Gemini provider scaffolding exists in the shared AI package, but current runtime initialization is limited to OpenAI, Anthropic, and xAI
- Some areas are still evolving, especially UX polish, copy consistency, and infrastructure hardening
