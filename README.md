<!-- coderabbit-ai-generated:v1 -->

# Nexora

Nexora is an event discovery and ticketing prototype for African markets. It includes a React marketplace, organizer tools, a ticket wallet, gate scanning and administrative dashboards, backed by an Express API and an optional Supabase schema.

**Current status: demonstration only.** Orders, ticket issuance, inventory, ledger entries, transfers and much of the administration are simulated in browser storage. Checkout does not charge a payment provider; webhook endpoints authenticate and acknowledge messages but do not settle orders. The interface includes example metrics and simulated integrations. Do not use this application for real payments, personal data or production events until the gaps below are addressed.

## Architecture

- `src/App.tsx` and `src/components/`: marketplace, checkout, wallet, organizer and admin interfaces.
- `src/lib/store.ts`: seeded demonstration data and browser-local state. Separate browsers do not share inventory or transactions.
- `src/lib/supabase.ts`: optional Supabase client and integration helpers.
- `server.ts`: Express API, optional Gemini calls, webhook signature checks and the Vite development middleware or built static application.
- `supabase_schema.sql`: proposed tables, policies and database routines; this is not a complete application backend.
- `public/`: service worker and web manifest.

## Requirements and local setup

Use Node.js 24 and Bun (the repository uses `bun.lock`). The following commands were exercised with Node 24.21.0 and Bun 1.4.2.

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Open `http://localhost:3000`. The app can be explored without external credentials using demonstration data. Stop the server with Ctrl+C. `PORT` changes the listening port.

For a production-mode build of the prototype:

```sh
bun run build
bun run start
```

The Express process serves `dist` and the API. `bun run preview` serves only the Vite build and does not provide the Express endpoints. The build currently emits a large JavaScript chunk warning.

## Configuration

Copy `.env.example` and set only the integrations you need. Restart the server after changes. Vite browser configuration is embedded at build time, so rebuild after changing `VITE_` values. Never put service-role keys or provider secrets in `VITE_` variables.

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port; defaults to 3000. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_PROJECT_ID` | Optional public Supabase project configuration. |
| `GEMINI_API_KEY` | Enables server-side Gemini requests. Without it, AI endpoints return demonstration responses. |
| `PAYSTACK_SECRET_KEY` | Required to verify Paystack webhooks. |
| `STRIPE_WEBHOOK_SECRET` | Required to verify Stripe webhooks, including the timestamp and v1 signature. |
| `FLUTTERWAVE_SECRET_HASH` | Required for the legacy Flutterwave `verif-hash` webhook header. |
| `ADMIN_ROTATION_PASSKEY` | Enables the configuration rotation endpoint. Use only in a controlled test environment; changes are process-local and lost on restart. |

Webhook endpoints return 503 if their secret is missing and reject invalid signatures. They do not implement event processing, durable idempotency, payment verification or ticket issuance. The rotation endpoint only accepts HTTPS `*.supabase.co` project URLs. Browser-side credential rotation affects only the current session.

## Database

`supabase_schema.sql` is a starting schema for a fresh Supabase project. Review it and apply it using the Supabase SQL editor only in a disposable project first. It is not an idempotent migration for an existing deployment: policies already present can cause errors. Existing databases need a reviewed migration, including removal of the previous permissive check-in policy, revised functions, grants and profile restrictions. No database migration or live Supabase validation was performed as part of this change.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:10073c08d302028daf4c9f6b025bcce7bdfc5ef6e1039cb5c1017d6835eca375 -->

The schema was applied to disposable PostgreSQL 17 with mock Supabase roles, and targeted privilege and input checks passed. This does not replace validation against a Supabase project. The schema restricts the privileged scanning and wristband routines to `service_role`.

<!-- /coderabbit-ai-generated:v1 --> A trusted backend must authorize each staff action before invoking them. Never expose a service-role key to the browser. Profile owners can update contact fields but cannot grant themselves an administrative role.

## Checks

```sh
bun run lint       # TypeScript check
bun run test       # server webhook and rotation integration test
bun run build      # client build
bun audit          # dependency advisory check
```

The server test starts a separate production-mode process on a temporary port with synthetic secrets. No live provider credentials are required.

## Before production

1. Replace browser-local orders, stock, tickets, transfers and ledger entries with a transactional backend, enforce ownership and reconcile every financial operation. Handle concurrency, recovery and audit trails.
2. Implement provider payment initiation, verified server-side settlement, durable webhook deduplication and refunds. Do not treat a redirect, a simulated gateway or a signed webhook acknowledgement as proof of settlement.
3. Replace the client-side administrative gate and process-local passkey with server-enforced authentication, roles, authorization, rate limiting, secret management and audit logging. Protect AI and other sensitive API endpoints from anonymous use.
4. Review and test the database schema and RLS using separate anonymous, authenticated, staff and service identities. Implement scoped staff authorization, safe migrations and backups. The current client-side Supabase check-in helper is not a production scanner.
5. Replace fabricated demonstration intelligence and operational metrics with verified data, and implement real notifications and integrations. Review privacy, retention, accessibility, monitoring and incident response. Add end-to-end, concurrency and provider integration tests before release.

## API overview

The Express server exposes `GET /api/health`, optional AI endpoints under `/api/ai/`, a simulated waitlist endpoint, provider webhook endpoints under `/api/webhooks/`, and Supabase status/configuration endpoints. The health endpoint indicates only that the process responds; it does not establish database connectivity or financial correctness.
