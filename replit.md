# InvestIQ - Investment & Risk Dashboard

## Overview
InvestIQ is a professional investment and risk analytics dashboard for fund of funds and wealth management. It offers comprehensive performance measurement, advanced risk analysis, and robust stress testing. The platform integrates portfolio management, AI-powered document analysis, and sophisticated simulation tools to enhance decision-making and optimize investment strategies for financial professionals.

## User Preferences
I prefer simple language and detailed explanations.
I want iterative development and prefer to be asked before making major changes.
Do not make changes to the `shared/schema.ts` file without explicit instruction.
Ensure all UI components are fully responsive and accessible.
Prioritize secure coding practices, especially for authentication and data handling.

## System Architecture
InvestIQ uses a modern full-stack architecture. The frontend is built with React 18, TypeScript, Shadcn/ui, Tailwind CSS, Recharts, Wouter, and TanStack Query. The backend is an Express.js application in TypeScript, using PostgreSQL via Drizzle ORM. Authentication is handled by Passport.js with a local, session-based strategy and scrypt for password hashing. Vite is used for building.

Key architectural features include:
- **Modular Frontend**: Components are organized by feature, with dedicated pages for Dashboard, Portfolio, Performance, Risk, Stress Tests, and custom tools.
- **Robust Backend Services**: Separated concerns for authentication, database interaction, file parsing, AI memo generation, and integrations.
- **Comprehensive Data Model**: A PostgreSQL schema supports portfolios, holdings, performance history, risk metrics, stress tests, AI-generated memos, custom portfolios, backtest results, a strategy library, and benchmarks, including custom composite benchmarks.
- **Advanced Analytics Engine**: Includes a Monte Carlo simulation engine for portfolio backtesting with bootstrap sampling and a portfolio optimizer (Maximum Return, Sharpe Ratio, Convexity).
- **AI Integration**: OpenAI GPT-5.2 generates professional investment memos from uploaded documents using various templates.
- **UI/UX Design**: A professional financial theme defaults to dark mode, with a cyan/blue accent, green for positive, red for negative, and a dark sidebar with a light content area.
- **Automatic Data Lookup**: Alpha Vantage API integration for investment names, expected returns, and volatility.
- **Analytics Glossary**: Provides definitions, formulas, and interpretations for all financial metrics.
- **Dynamic Analytics**: All analytics across Dashboard, Risk Analytics, and Performance pages are dynamically calculated from portfolio performance history, selected benchmark returns, and FRED-sourced risk-free rate.
- **Advanced Risk Engine**: Enhanced calculations for Cornish-Fisher VaR, Expected Shortfall, Modified Sharpe Ratio, Kurtosis-Adjusted Volatility, Conditional Drawdown at Risk, Drawdown Duration Analysis, Component/Marginal Risk Contributions, Factor Risk Decomposition, Ledoit-Wolf Shrinkage Covariance Estimator, and Monte Carlo Stress Simulation.
- **Monte Carlo Factor-Model Stress Testing**: Stress testing includes 200-path Monte Carlo simulations across 5 stress regimes.
- **Frequency-Aware Charts & Labels**: Charts dynamically adapt x-axis labels, tick intervals, and metric labels based on detected data frequency (daily, weekly, monthly, quarterly).
- **Time-Period-Aware Benchmark Processing**: Benchmark returns are processed for specific time periods and cadences.
- **Return Analyzer (Manager Diligence)**: A dedicated `/return-analyzer` workflow for evaluating a prospective manager from an uploaded return stream. Upload a CSV/Excel of periodic returns or NAV levels, confirm the column mapping, and receive a full analytical pack plus a scored investment committee recommendation. Implemented as `server/returnStreamParser.ts` (tolerant file parsing), `server/returnStreamStats.ts` (statistical primitives), `server/returnStreamAnalytics.ts` (the analytics engine), `server/icRecommendation.ts` (scoring and memo), and `server/returnStreamRoutes.ts` (API). The feature is stateless — nothing is persisted, since a manager's return stream under evaluation is sensitive pre-trade information and the analysis is reproducible from the file. Coverage includes:
  - **Parsing**: percent / decimal / NAV-level auto-detection with user override, many date formats (ISO, `Jan-21`, `Q1 2021`, `1/31/2021`, Excel serials), newest-first files, title rows, multi-sheet workbooks, thousands separators and accounting negatives.
  - **Return**: cumulative and geometric annualized return, trailing windows, calendar years, monthly return grid, rolling windows, hit rate, gain/loss ratio, streaks.
  - **Risk**: annualized volatility, downside/upside deviation, skew, excess kurtosis, Jarque-Bera normality, historical / Gaussian / Cornish-Fisher VaR and CVaR at 95% and 99%, drawdown episodes with recovery timing, Ulcer and pain indices, conditional drawdown, time under water, worst rolling windows.
  - **Risk-adjusted**: Sharpe, Adjusted Sharpe (Pezier-White), Modified Sharpe (VaR-based), Sortino, Calmar, Sterling, Burke, Martin, Omega, Kappa-3, gain-to-pain, common sense ratio, Probabilistic Sharpe Ratio and Minimum Track Record Length.
  - **Benchmark-relative**: full CAPM regression with standard errors, alpha t-statistic and p-value, beta (full, up-market, down-market), R², tracking error, information ratio, Treynor, geometric up/down capture, batting average, appraisal ratio and M².
  - **Return-smoothing diagnostics**: autocorrelation by lag with significance bands, Ljung-Box test, and first-order Geltner unsmoothing that restates volatility, Sharpe and drawdown. This is central to hedge fund diligence — appraisal-priced or stale marks flatter every reported risk figure.
  - **Forward-looking**: stationary block bootstrap (seeded, so results are reproducible) with block length scaled to measured serial dependence, producing a percentile fan chart, probability of loss by horizon, and expected maximum drawdown.
  - **IC recommendation**: a deterministic, rule-based composite score across five weighted pillars (Return Generation, Risk Control, Risk-Adjusted Efficiency, Benchmark Value-Add, Consistency & Persistence), each expandable to its individual drivers and thresholds. Data-integrity findings are applied as a deduction rather than averaged in, since smoothed or short data undermines the other pillars instead of trading off against them. Produces a verdict, red flags with manager-facing diligence questions, and a downloadable ten-section markdown memorandum.
- **Cadence-Aware Risk Calculations**: All risk metrics (volatility, Sharpe, Sortino, VaR, tracking error, beta, alpha, component risk, factor decomposition, tail metrics, Monte Carlo) use `detectPeriodsPerYear()` to auto-detect data frequency (quarterly=4, monthly=12, daily=252) instead of hardcoded 252. This prevents gross miscalculation of annualized metrics when using monthly fund-of-funds data.

## External Dependencies
- **OpenAI GPT-5.2**: For AI-powered investment memo generation and fund detail extraction.
- **Microsoft Graph API**: For OneDrive file access and import.
- **Google APIs**: For Google Drive integration (Investment Library).
- **PostgreSQL**: Primary database.
- **Alpha Vantage API**: For real-time market data lookup (investment names, expected returns, volatility, and benchmark return data for ETFs).
- **FRED API**: For fetching the 3-month Treasury bill rate.