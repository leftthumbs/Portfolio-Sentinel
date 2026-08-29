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

Required environment: `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`.
Optional: `ALPHA_VANTAGE_API_KEY`, `FRED_API_KEY`, `OPENFIGI_API_KEY`.

## Known Constraints
- **Google Drive and OneDrive import only work on Replit.** `server/gmail.ts`
  and `server/onedrive.ts` fetch credentials from Replit's connector broker via
  `REPLIT_CONNECTORS_HOSTNAME`, authenticated with `REPL_IDENTITY` or
  `WEB_REPL_RENEWAL`. Off Replit those variables do not exist and both throw,
  taking eight endpoints with them. Moving to standard OAuth client credentials
  is the remaining piece of un-Replit-ing this project.
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
