# InvestIQ - Investment & Risk Dashboard

## Overview
InvestIQ is a professional investment and risk analytics dashboard designed for fund of funds and wealth management portfolios. It provides comprehensive capabilities for performance measurement, advanced risk analysis, and robust stress testing. The platform aims to be an indispensable tool for financial professionals by integrating portfolio management, AI-powered document analysis, and sophisticated simulation tools, thereby enhancing decision-making and optimizing investment strategies.

## User Preferences
I prefer simple language and detailed explanations.
I want iterative development and prefer to be asked before making major changes.
Do not make changes to the `shared/schema.ts` file without explicit instruction.
Ensure all UI components are fully responsive and accessible.
Prioritize secure coding practices, especially for authentication and data handling.

## System Architecture
InvestIQ employs a modern full-stack architecture. The frontend is built with React 18 and TypeScript, utilizing Shadcn/ui components, Tailwind CSS for styling, and Recharts for data visualization. Routing is managed by Wouter and data fetching with TanStack Query. The backend is an Express.js application, also written in TypeScript, interacting with a PostgreSQL database via Drizzle ORM. Authentication is handled using Passport.js with a local strategy, session-based authentication, and scrypt for password hashing. The project uses Vite for building.

Key architectural features include:
- **Modular Frontend**: Components are organized by feature and reusability, with dedicated pages for various functionalities like Dashboard, Portfolio, Performance, Risk, Stress Tests, and custom tools.
- **Robust Backend Services**: Separated concerns for authentication, database interaction, file parsing, AI memo generation, and integrations (OneDrive, Gmail).
- **Comprehensive Data Model**: A detailed PostgreSQL schema supports portfolios, holdings, performance history, risk metrics, stress tests, AI-generated memos, custom portfolios, backtest results, a strategy library, and benchmarks, including custom composite benchmarks.
- **Advanced Analytics Engine**: Includes a Monte Carlo simulation engine for portfolio backtesting with bootstrap sampling and a portfolio optimizer supporting goals like Maximum Return, Maximum Sharpe Ratio, and Maximum Convexity.
- **AI Integration**: OpenAI GPT-5.2 is used for generating professional investment memos from uploaded documents, offering "Institutional Summary", "Everest Investment Summary", and "Verita Investment Memo" templates with rich formatting.
- **UI/UX Design**: A professional financial theme is applied, defaulting to dark mode, with a cyan/blue accent for primary actions, green for positive indicators, and red for negative. A dark sidebar complements a light content area.
- **Automatic Data Lookup**: Integration with Alpha Vantage API for automatic fetching of investment names, expected returns, and volatility based on ticker symbols.
- **Analytics Glossary**: Provides definitions, formulas, and interpretations for all financial metrics presented on the dashboard.

## External Dependencies
- **OpenAI GPT-5.2**: Used for AI-powered investment memo generation.
- **Microsoft Graph API**: Integrated for OneDrive file access and import capabilities.
- **Google APIs**: Utilized for Gmail integration (listing messages, reading emails, sending emails, searching, and label management).
- **PostgreSQL**: Primary database for all application data.
- **Alpha Vantage API**: Used for real-time market data lookup, specifically for investment names, expected returns, and volatility based on ticker symbols.
- **FRED API**: Integrated for fetching the 3-month Treasury bill rate (DTB3 series), with a 24-hour caching mechanism. Used as the default risk-free rate for Sharpe ratio calculations in Monte Carlo simulations.

## Recent Changes
- **Time Period Filtering** (Feb 2026): Global time period selector (YTD, LTM, 1Y, 3Y, 5Y, 10Y, Since Inception) in sidebar footer. Selection persists via localStorage across Dashboard, Performance, and Risk Analytics pages. Performance history data is filtered client-side based on selected period, with metrics recalculated for the filtered timeframe. Shared helper functions (getTimePeriodStartDate, getTimePeriodLabel, filterDataByTimePeriod) centralized in client/src/components/time-period-selector.tsx.
- **Global Portfolio & Benchmark Selection** (Feb 2026): Unified global portfolio and benchmark selectors in the sidebar footer. Selection persists across all analytics pages (Dashboard, Risk Analytics, Stress Testing) via localStorage. The usePortfolio hook provides selectedPortfolioId, selectedBenchmarkId, and their full objects (selectedPortfolio, selectedBenchmark). Portfolio dropdown groups by Core Portfolios and Custom Portfolios; benchmark dropdown groups by Custom Benchmarks and standard benchmark categories.
- **Custom Composite Benchmarks** (Feb 2026): Full CRUD management for custom composite benchmarks at /benchmarks page. Users can create weighted combinations of standard benchmarks (e.g., 60% S&P 500 + 40% Bloomberg Aggregate Bond) for custom portfolio comparisons. Composite benchmarks are integrated into the Risk Analytics page benchmark selector for rolling alpha analysis with returns calculated on-the-fly from component weights.
- **Custom Portfolio Analytics Integration** (Feb 2026): Risk Analytics and Stress Testing pages now fully support custom portfolios created in Portfolio Builder. Both pages include portfolio selectors and calculate metrics based on actual portfolio holdings and backtest results.
- **Customizable Risk-Free Rate** (Feb 2026): Portfolio backtesting now fetches the current 3-month T-bill rate from FRED API as the default risk-free rate. Users can manually adjust this value in the Portfolio Builder before running simulations.
- **Stress Testing for Custom Portfolios**: Stress tests now use actual asset class weights from custom portfolio items to calculate scenario impacts, rather than hardcoded weights.
- **Fund Analysis Document Upload** (Feb 2026): The Fund Analysis page now includes a Fund Inventory tab with drag-and-drop document upload. Users can upload PDF, DOCX, XLSX, or CSV fund documents, which are processed using OpenAI GPT-5.2 to automatically extract fund details (name, strategy, fees, terms, performance metrics). Extracted funds are stored in the strategy library and displayed in a searchable, sortable inventory table. Legacy .doc format is not supported.
- **Folder-Based Fund Organization** (Feb 2026): Fund Analysis page now supports folder-based organization for data room materials. Users can create, rename, and delete folders with optional color coding. Funds can be moved between folders using the move-to-folder action in the inventory table. The folder panel shows fund counts per folder and supports filtering by "All Funds", "Unfiled", or specific custom folders.
- **Data Room Folder Organization** (Feb 2026): Extended folder organization to the Data Room page. Both Documents and Memos tabs now have dedicated folder panels with create, rename, and delete capabilities. Users can organize uploaded documents and AI-generated memos into custom folders with optional color coding. Folder selection filters the displayed items, and move-to-folder buttons allow easy reorganization. Folder types (fund, document, memo) are distinguished in the database via the folderType field.
- **Portfolio Comparison** (Feb 2026): New page at /portfolio-compare allows side-by-side comparison of 2-3 custom portfolios. Features include summary cards (Total Return, Sharpe Ratio, Max Drawdown, Final Value), overlaid performance line chart showing cumulative returns, risk metrics comparison table (Sharpe, Sortino, Volatility, Max Drawdown, Beta, Alpha, Calmar Ratio), and asset allocation comparison bar chart. API endpoint uses date-aligned benchmark returns and centralized risk calculations with FRED-backed risk-free rate. Navigation link in sidebar under Tools section.