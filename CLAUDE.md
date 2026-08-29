# InvestIQ — Investment & Risk Analytics Dashboard

## Overview
InvestIQ is an investment and risk analytics dashboard for fund-of-funds and
wealth management: performance measurement, risk analysis, stress testing,
portfolio construction, and AI-assisted document analysis.

## Working Preferences
- Simple language and detailed explanations.
- Iterative development; ask before major changes.
- `shared/schema.ts` may be edited when the work genuinely needs it, but call
  out every schema change explicitly in the commit message — migrations are the
  changes hardest to reverse.
- UI components should be responsive and accessible.
- Prioritise secure coding, especially around authentication and data handling.
- Analytics changes need tests with independently derived expected values.
  Deriving them by running the code under test defeats the purpose: it pins
  current behaviour rather than correct behaviour, and every defect found in
  this codebase so far would have survived that.

## Deliberate Architectural Decisions

### Single-tenant by design
There is no `userId` column on the owned tables and `storage.ts` methods take no
user argument. Every authenticated user sees the same data, and that is
intended — InvestIQ is operated as a shared book, not a multi-customer service.

This is a decision, not a gap. Do not add per-user data isolation without an
explicit instruction to change the model. The `/api` session guard
(`server/requireAuth.ts`) is what keeps data non-public; per-user scoping would
be machinery nobody uses.

### Deterministic simulation
Every Monte Carlo path in the codebase runs off a seeded PRNG rather than
`Math.random`: the optimizer weight search, the scenario engine, and the
backtester. Results are shown to an investment committee and, in the
backtester's case, persisted and exported for audit — a figure that cannot be
re-derived from its own inputs is not one anyone can act on. Each accepts a
`seed` override for deliberately exploring sampling variation.

### Analytics say when they are guessing
Correlation estimation, return unsmoothing and the liquidity ladder all degrade
to documented defaults when the data they need is missing, and each reports
which path it took. Preserve that. Silently substituting an assumption for an
estimate is the failure mode these modules exist to avoid.

## Architecture
Frontend: React 18, TypeScript, shadcn/ui, Tailwind, Recharts, Wouter, TanStack
Query. Backend: Express 5 in TypeScript, PostgreSQL via Drizzle ORM,
Passport.js local sessions with scrypt hashing. Vite for builds.

- **Auth**: `server/requireAuth.ts` guards every `/api` route ahead of the route
  table, so new routes are protected by default. Public endpoints are
  allowlisted inside it.
- **Analytics engine**: ten modules, all reachable from `routes.ts` and all
  covered by tests — `riskCalculations`, `benchmarkCalculations`,
  `scenarioEngine`, `unsmoothing`, `correlation`, `liquidity`, `optimizer`,
  `backtester`, `intervalFundAnalyzer`, `dataValidation`.
- **Cadence awareness**: every annualized metric detects data frequency via
  `detectPeriodsPerYear()` rather than assuming 252 trading days. Monthly
  fund-of-funds data annualized at 252 overstates Sharpe by roughly √21.

## Commands
```
npm run dev        # development server
npm test           # 359 tests
npm run check      # typecheck (23 pre-existing errors, all in routes.ts)
npm run build      # production build
npm run db:push    # apply schema to the database
```

### Configuration
Copy `.env.example` to `.env` and fill it in; `server/index.ts` and
`drizzle.config.ts` both load it. Real environment variables take precedence, so
a hosting platform's own settings are never overridden by the file.

Required: `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`.
Optional: `GOOGLE_SERVICE_ACCOUNT_JSON`, the four OneDrive variables,
`ALPHA_VANTAGE_API_KEY`, `FRED_API_KEY`, `OPENFIGI_API_KEY`.

## Cloud Document Import

Both integrations read a fixed folder on behalf of the application, not on
behalf of whoever is signed in. That makes them server-to-server, so neither
uses a user OAuth flow: there is no consent screen, and no refresh token to
expire or be revoked.

### Google Drive — service account
1. Google Cloud console: create a project, enable the **Google Drive API**.
2. Create a **service account**; create a key and download the JSON.
3. In Google Drive, share the **Investment Library** folder with the service
   account's email address (`...@....iam.gserviceaccount.com`). Viewer is
   enough — the account can see nothing else, which is the point.
4. Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the key file's contents, raw or
   base64-encoded.

The app requests `drive.readonly` only. Download the **service account key**,
not the OAuth client file — the latter parses as valid JSON but carries neither
`client_email` nor `private_key`, and the code rejects it by name.

### OneDrive — client credentials
1. Microsoft Entra ID: **register an application**.
2. Add the **`Files.Read.All` application permission** — the application
   column, not delegated — and **grant admin consent**.
3. Create a **client secret**.
4. Set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and
   `ONEDRIVE_USER` (the UPN or object id of the account whose OneDrive holds
   the documents).

`ONEDRIVE_USER` exists because of a trap worth knowing: under application
permissions there is no signed-in user, so `/me/drive` does not resolve and
every request returns 400. Every call addresses the drive explicitly via
`/users/{id}/drive`. If you add a Graph call, do not reach for `/me`.

Unconfigured, both return 503 with a message naming the missing variables.

## Known Constraints
- **The app will not start without `OPENAI_API_KEY`.** `memoGenerator.ts`
  constructs the client at module load, so a missing key stops the process
  before it can serve anything, including pages that never touch AI.
- **`routes.ts` is ~4,800 lines** and holds all 107 API handlers. Split it by
  domain as handlers are touched rather than in one move.
- **23 pre-existing type errors**, all Drizzle inference on query results in
  `routes.ts`. CI reports them without failing; make it a gate once they reach
  zero.
- **Untested**: the route handlers, `storage.ts`, memo generation, and the
  ingest and vendor adapters. Every module that produces a number is covered.

## External Dependencies
OpenAI (memo generation), Alpha Vantage (prices and ETF returns), FRED
(3-month T-bill), Microsoft Graph (OneDrive), Google Drive, PostgreSQL.
