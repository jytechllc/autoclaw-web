# AutoClaw Web

AutoClaw Web is the open-source Next.js frontend and API layer for the AutoClaw platform. It provides a multilingual marketing site, authenticated dashboard, billing and subscription flows, admin invoicing, and automation endpoints used by worker services.

This repository was split from a larger monorepo to keep web development, review, and community contribution focused.

## What It Includes

- Next.js App Router application (`app/`) with locale-aware pages and dashboard UX
- API routes for organizations, projects, reports, team members, invoicing, chat, checkout, and subscriptions
- Scheduled maintenance endpoints for audit retention, key cleanup, and report sync
- OSS Model Watch: daily Hugging Face scan of open-source model releases and trending, with a markdown digest (`lib/oss-monitor.ts`)
- Stripe integration for subscription flows
- PostgreSQL access via Neon serverless driver
- Zod-based request validation and API key / webhook related security utilities

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Stripe
- Zod
- Neon Serverless Postgres

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env.local` in the repository root.

Minimum required variables depend on which features you run. Common variables used by the app include:

- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_GROWTH_PRICE_ID`
- `STRIPE_SCALE_PRICE_ID`
- `WORKER_URL`
- `WORKER_AUTH_SECRET`
- `CRON_SECRET`
- `OPENCLAW_WEBHOOK_URL`
- `OPENCLAW_WEBHOOK_SECRET`
- `ENCRYPTION_KEY`

Optional integrations used by specific routes/features:

- `GA_SERVICE_ACCOUNT_KEY`
- `BREVO_API_KEY`
- `HUNTER_API_KEY`
- `SNOV_API_ID`
- `SNOV_API_SECRET`
- `NVIDIA_API_KEY`
- `CEREBRAS_API_KEY`

### 3. Run the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

- `npm run dev` - Start local dev server
- `npm run build` - Build production bundle
- `npm run start` - Run production server
- `npm run lint` - Run ESLint

## Scheduled Jobs

This repository includes GitHub Actions based maintenance scheduling in
`.github/workflows/cron-maintenance.yml`.

Configured jobs:

- Every 10 minutes: `/api/cron/sync-openclaw`
- Every 30 minutes: `/api/cron/run-agents`
- Hourly: `/api/cron/process-embeddings`
- Daily at 03:00 UTC: `/api/cron/audit-retention`
- Daily at 03:15 UTC: `/api/cron/key-cleanup`

Required GitHub Actions configuration:

- Repository variable: `AUTOCLAW_BASE_URL`
- Repository secret: `CRON_SECRET`

## Repository Structure

- `app/` - UI routes and API route handlers
- `components/` - Shared UI components
- `lib/` - DB, auth, validation, crypto, and integration helpers
- `public/` - Static assets
- `scripts/` - Utility scripts (for example key rotation)

## Contributing

Issues and pull requests are welcome.

If you want to contribute:

1. Open an issue describing the bug or proposal.
2. Submit a PR with focused scope and clear test/verification notes.
3. Avoid committing secrets or environment-specific files.

## Security

If you discover a security issue, please report it privately to the maintainers instead of opening a public issue.
