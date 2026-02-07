import OpenAI from "openai";
import type { DataRoomDocument, Holding, Portfolio, RiskMetrics, MemoTemplateType } from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface MemoContext {
  portfolio: Portfolio;
  holdings: Holding[];
  riskMetrics: RiskMetrics | null;
  documents: DataRoomDocument[];
  templateType?: MemoTemplateType;
}

const INSTITUTIONAL_TEMPLATE = `
# EXECUTIVE SUMMARY

## [Investment/Fund Name]
**Prepared for the Investment Committee**
*Date: [Current Date]*

---

## MANAGER SUMMARY

| Field | Details |
|-------|---------|
| Inception | [Year] |
| Headquarters | [Location] |
| Firm Assets | [Total AUM] |
| Fund Strategy Assets | [Strategy-specific AUM] |
| Asset Class | [Primary asset class] |
| Sub-Asset Class | [Specific strategy type] |
| Mgmt. Fee | [Management fee %] |
| Incentive Fee | [Performance fee structure if applicable] |
| Fund Term | [Evergreen/Closed-end/etc.] |
| Leverage | [Leverage policy] |

---

## EXECUTIVE SUMMARY

[2-3 paragraph overview of the investment opportunity, key value proposition, and fit within portfolio]

---

## FIRM OVERVIEW

[Detailed background on the investment manager, their track record, team experience, and competitive advantages]

---

## INVESTMENT OVERVIEW

**Core Strategy:** [Brief description of investment approach]

**Key Characteristics:**
- Core Exposure: [Primary investment focus]
- Investment Themes: [Key themes or sectors]
- Geography: [Geographic allocation breakdown]
- Liquidity: [Liquidity terms and structure]
- Benchmark: [Relevant benchmark]
- Expected Return: [Target return range]

---

## REASONS TO RE-ASSESS / REDEEM

### Performance & Risk Metrics
- [Specific quantitative triggers for performance concerns]
- [Volatility or drawdown thresholds]
- [Risk-adjusted return deterioration criteria]

### Portfolio Composition / Strategy Drift
- [Criteria for strategy deviation]
- [Concentration or allocation drift triggers]

### Liquidity & Leverage
- [Redemption stress indicators]
- [Leverage threshold concerns]

### Governance / Process Concerns
- [Key person or operational triggers]
- [Transparency or reporting issues]

### Market/Macro Context
- [Environmental changes that would reduce opportunity set]

---

## INVESTMENT MERITS

1. **[Merit 1 Title]:** [Detailed explanation of competitive advantage]

2. **[Merit 2 Title]:** [Detailed explanation]

3. **[Merit 3 Title]:** [Detailed explanation]

4. **[Merit 4 Title]:** [Detailed explanation]

5. **[Merit 5 Title]:** [Detailed explanation]

---

## INVESTMENT RISKS & MITIGANTS

### [Risk Category 1]
**Risk:** [Description of the risk]
**Mitigant:** [How this risk is addressed or managed]

### [Risk Category 2]
**Risk:** [Description of the risk]
**Mitigant:** [How this risk is addressed or managed]

### [Risk Category 3]
**Risk:** [Description of the risk]
**Mitigant:** [How this risk is addressed or managed]

### [Risk Category 4]
**Risk:** [Description of the risk]
**Mitigant:** [How this risk is addressed or managed]

---

## RECOMMENDATION

[Clear investment recommendation with rationale, including:
- Recommended action (approve, maintain, increase, reduce, or redeem)
- Size and timing considerations
- Key monitoring items going forward]

---

*This memorandum has been prepared for the Investment Committee and contains confidential information intended solely for internal decision-making purposes.*

*Prepared by: [Investment Team]*
*Date: [Current Date]*`;

const EVEREST_INVESTMENT_SUMMARY_TEMPLATE = `
# EVEREST PRIVATE WEALTH
## INVESTMENT SUMMARY

---

# [Fund/Manager Name]
**[Fund Ticker if applicable]**

---

## MANAGER SUMMARY

| Attribute | Details |
|-----------|---------|
| **Inception** | [Year] |
| **Headquarters** | [City, Country] |
| **Firm Assets** | [Total firm AUM] |
| **Fund Strategy Assets** | [Strategy-specific AUM as of date] |
| **Asset Class** | [Primary asset class] |
| **Sub Asset Class** | [Specific strategy type] |
| **Mgmt. Fee** | [Management fee percentage] |
| **Incentive Fee** | [Performance fee structure with hurdle rate and high-water mark details] |
| **Fund Term** | [Evergreen/Closed-end/Interval] |
| **Leverage** | [Leverage limit as % of assets] |

---

## EXECUTIVE SUMMARY

[2-3 comprehensive paragraphs covering:
- Fund sponsor/manager overview and ownership
- Strategy focus and investment approach
- Geographic allocation
- Liquidity structure and terms
- Tax reporting format (1099 vs K-1)
- Key differentiators from core direct lending]

---

## FIRM OVERVIEW

### [Manager Name] Overview
[Detailed description of the investment manager including:
- Founding year and history
- Parent company or ownership structure
- Total AUM breakdown by strategy
- Geographic presence and office locations
- Key competitive advantages]

### Investment Team
[Description of team structure, key personnel, experience levels, and any notable expertise]

---

## INVESTMENT OVERVIEW

### Core Strategy
[Detailed description of the investment strategy and approach]

### Investment Characteristics

| Characteristic | Details |
|----------------|---------|
| **Core Exposure** | [Primary investment focus areas] |
| **Investment Themes** | [Key investment themes and opportunities] |
| **Geography** | [Geographic breakdown with percentages - e.g., North America X%, Europe Y%, Emerging Z%] |
| **Liquidity** | [Liquidity terms - e.g., quarterly repurchases ≥X% of NAV; daily NAV pricing] |
| **Benchmark** | [Primary benchmark - e.g., Cliffwater Direct Lending Index] |
| **Expected Return** | [Target return range - e.g., X-Y% net annualized] |

---

## REASONS TO RE-ASSESS / REDEEM

### Performance & Risk Metrics
- Returns below [X%] over rolling 12 months
- Underperformance vs. benchmark exceeding [X bps] over trailing 12 months
- Drawdown greater than [X%] absent systemic market shock
- Volatility or drawdown exceeding [X]x peer median
- NAV volatility exceeding [X]x peer median

### Portfolio Composition / Strategy Drift
- [Strategy type] exposure falling below [X%]
- Non-target geography exposure exceeding [X%]
- Senior secured/first-lien allocation falling below [X%]
- Higher-risk instruments (equity, convertibles) exceeding [X%]

### Liquidity & Redemption Pressure
- Repurchase requests exceeding [X%] of offered amount for [N] consecutive quarters
- Persistent pro-rata allocation indicating liquidity stress

### Leverage & Cost Concerns
- All-in expense ratio increase exceeding [X bps]
- Leverage levels exceeding stated limits without corresponding return improvement

### Governance / Process Concerns
- Key person departures (PM, CIO, senior analysts)
- Material changes to valuation methodology or service providers
- Reduction in reporting transparency or frequency

---

## INVESTMENT MERITS

### 1. [Merit Title - e.g., Experienced Global Credit Platform]
[Detailed explanation of competitive advantage with specific data points]

### 2. [Merit Title - e.g., Differentiated Strategy Focus]
[Detailed explanation of how strategy differs from competitors]

### 3. [Merit Title - e.g., Attractive Risk/Return Profile]
[Detailed explanation of expected returns vs. risk taken]

### 4. [Merit Title - e.g., Favorable Vehicle Structure]
[Detailed explanation of liquidity, tax treatment, accessibility]

### 5. [Merit Title - e.g., Diversification Benefits]
[Detailed explanation of portfolio diversification benefits]

---

## INVESTMENT RISKS & MITIGANTS

### Market/Credit Risk
**Risk:** [Description of market and credit-related risks - e.g., credit cycle sensitivity, default risk, mark-to-market volatility]
**Mitigant:** [How manager addresses this - e.g., senior secured focus, active hedging, diversification]

### Liquidity Risk
**Risk:** [Description of liquidity constraints - e.g., interval fund structure, potential proration, redemption queues]
**Mitigant:** [How this is managed - e.g., liquidity buffers, cash allocation, NAV pricing transparency]

### Operational/Valuation Risk
**Risk:** [Description of operational risks - e.g., complex positions requiring subjective valuation, multiple jurisdictions]
**Mitigant:** [How this is addressed - e.g., independent valuation agents, robust compliance framework]

### Currency/Geographic Risk
**Risk:** [Description of currency and geographic exposures]
**Mitigant:** [How hedging and geographic limits are implemented]

### Fee/Cost Risk
**Risk:** [Description of fee structure complexity and potential for fee drag]
**Mitigant:** [How fee structure compares to alternatives, alignment mechanisms like hurdle rates]

---

*Document prepared by Everest Private Wealth Investment Research*
*Date: [Current Date]*
`;

const VERITA_INVESTMENT_MEMO_TEMPLATE = `
# [Fund Name]

**As of [Current Date]**

# Investment Memorandum

---

## Contents

1. Manager & Key Terms Summary
2. Executive Summary
3. Firm Overview
4. Investment Overview
5. Investment Recommendations & Expectations
6. Investment Merits
7. Investment Risks & Mitigants
8. Market & Industry Overview
9. Track Record
10. Investment Process
11. Team Overview
12. Operations
13. Appendix: Case Studies
14. Appendix: Other

---

## Manager & Key Terms Summary

### MANAGER SUMMARY

| Attribute | Details |
|-----------|---------|
| Firm Inception | [Year] |
| Investor Contact | [Contact Name] |
| Firm Assets | [Total AUM] |
| Email | [Contact Email] |
| Headquarters | [City, Country] |
| Website | [Website URL] |

### FUND & STRATEGY SUMMARY

| Attribute | Details |
|-----------|---------|
| Fund/Strategy Inception | [Year] |
| Fund/Strategy Assets | [Strategy AUM] |
| Asset Class | [Primary Asset Class] |
| Sub-Asset Class | [Specific Strategy Type] |
| Investment Focus | [Investment Focus Description] |
| Geographic Focus | [Geographic Regions] |
| Investment Term | [Term Structure] |
| Liquidity | [Liquidity Terms] |
| Distributions/Yield | [Distribution Policy] |
| Redemption Notice | [Notice Period] |
| Management Fee | [Fee Percentage] |
| Incentive Fee | [Performance Fee Structure] |
| GP Commitment | [GP Investment Amount] |
| Leverage | [Leverage Policy/Limits] |

---

## Executive Summary

[Firm Name] ("[Abbreviation]" or the "Firm") is a [description of firm type and focus].

[Overview paragraph describing the firm's market positioning, key differentiators, and investment approach.]

[Additional context on the specific fund/strategy being presented and rationale for investment consideration.]

---

## Firm Overview

[Comprehensive description of the investment manager including founding history, ownership structure, total AUM, geographic presence, and core investment philosophy.]

[Additional detail on organizational evolution and key milestones.]

[Information on firm culture, values, and alignment of interests.]

---

## Investment Overview

[Detailed description of the investment strategy, approach, and methodology.]

[Target investments, opportunity set, and portfolio construction philosophy.]

[Value creation approach and exit strategy considerations.]

---

## Investment Recommendations & Expectations

**Benchmark:** [Primary benchmark(s) for performance comparison]

**Return/Risk Expectations:** [Target return range and risk parameters]

**Reasons to Review:** [Specific triggers warranting investment review]

**Reasons to Redeem:** [Criteria that would trigger redemption consideration]

---

## Investment Merits

**[Merit 1 Title]:** [Detailed explanation of competitive advantage with supporting evidence]

**[Merit 2 Title]:** [Detailed explanation of differentiated capability or positioning]

**[Merit 3 Title]:** [Detailed explanation of structural advantage or value driver]

**[Merit 4 Title]:** [Detailed explanation of additional investment merit]

---

## Investment Risks & Mitigants

**[Risk 1 Title]:** [Description of risk and corresponding mitigant]

**[Risk 2 Title]:** [Description of risk and corresponding mitigant]

**[Risk 3 Title]:** [Description of risk and corresponding mitigant]

**[Risk 4 Title]:** [Description of risk and corresponding mitigant]

---

## Market & Industry Overview

[Overview paragraph on current market environment and relevance to strategy.]

### Market Context

[Analysis of macroeconomic backdrop, industry trends, and opportunity set.]

[Current dynamics affecting the investment landscape.]

[Timing considerations and market cycle positioning.]

### Competitive Landscape

[Assessment of key competitors and market positioning.]

[Differentiation factors and barriers to entry.]

[Sustainable competitive advantages.]

---

## Track Record

[Performance summary and context.]

| Fund | MOIC | IRR |
|------|------|-----|
| [Fund 1] | [X.Xx] | [XX%] |
| [Fund 2] | [X.Xx] | [XX%] |
| [Fund 3] | [X.Xx] | [XX%] |

*Source: [Data Source]*

[Additional context on performance attribution, benchmark comparisons, and return consistency.]

---

## Investment Process

[Sourcing and origination approach.]

[Due diligence methodology and rigor.]

[Investment committee structure and decision-making process.]

[Portfolio monitoring and ongoing management.]

---

## Team Overview

[Key personnel profiles and backgrounds.]

[Team structure, responsibilities, and tenure.]

[Relevant experience and track record of key individuals.]

[Succession planning and organizational stability.]

---

## Operations

[Operational platform and infrastructure overview.]

[Key service providers (administrator, auditor, legal counsel).]

[Risk management framework and compliance capabilities.]

[Reporting quality and transparency.]

---

## Appendix: Case Studies

[Representative case study demonstrating investment approach, thesis, execution, and outcome.]

[Additional case studies illustrating value creation and risk management.]

---

## Appendix: Other

[Supplementary materials, historical performance details, and additional reference information as applicable.]

---
`;

const INVESTMENT_SUMMARY_TEMPLATE = `
# [Fund Name]
**Investment Summary**
*As of [Current Date]*

---

## Manager & Key Terms Summary

### Manager Summary

| Attribute | Details |
|-----------|---------|
| **Firm Inception** | [Year] |
| **Headquarters** | [City, Country] |
| **Firm Assets** | [Total AUM] |
| **Website** | [Website URL] |

### Fund & Strategy Summary

| Attribute | Details |
|-----------|---------|
| **Fund/Strategy Inception** | [Year] |
| **Fund/Strategy Assets** | [Strategy AUM] |
| **Asset Class** | [Primary Asset Class] |
| **Sub-Asset Class** | [Specific Strategy Type] |
| **Investment Focus** | [Investment Focus Description] |
| **Geographic Focus** | [Geographic Regions] |
| **Investment Term** | [Term Structure] |
| **Liquidity** | [Liquidity Terms] |
| **Distributions/Yield** | [Distribution Policy] |
| **Redemption Notice** | [Notice Period] |
| **Management Fee** | [Fee Percentage] |
| **Incentive Fee** | [Performance Fee Structure] |
| **GP Commitment** | [GP Investment Amount] |
| **Leverage** | [Leverage Policy/Limits] |

---

## Executive Summary

[2-3 comprehensive paragraphs providing:
- Overview of the firm and its positioning in the market
- Key investment strategy and approach
- Value proposition and fit within portfolio context]

---

## Investment Merits

### 1. [Merit Title]
[Detailed explanation of competitive advantage with supporting evidence]

### 2. [Merit Title]
[Detailed explanation of differentiated capability or positioning]

### 3. [Merit Title]
[Detailed explanation of structural advantage or value driver]

### 4. [Merit Title]
[Detailed explanation of additional investment merit]

---

## Investment Risks & Mitigants

### [Risk Category 1]
**Risk:** [Description of the specific risk]
**Mitigant:** [How this risk is addressed, managed, or hedged]

### [Risk Category 2]
**Risk:** [Description of the specific risk]
**Mitigant:** [How this risk is addressed, managed, or hedged]

### [Risk Category 3]
**Risk:** [Description of the specific risk]
**Mitigant:** [How this risk is addressed, managed, or hedged]

### [Risk Category 4]
**Risk:** [Description of the specific risk]
**Mitigant:** [How this risk is addressed, managed, or hedged]

---

## Track Record

[Performance summary and analysis]

| Fund/Vehicle | MOIC | IRR |
|--------------|------|-----|
| [Fund 1] | [X.Xx] | [XX%] |
| [Fund 2] | [X.Xx] | [XX%] |
| [Fund 3] | [X.Xx] | [XX%] |

*Source: [Data Source]*

---

*Investment Summary prepared by [Firm Name]*
*Date: [Current Date]*
`;

const VERITA_INVESTMENT_SUMMARY_TEMPLATE = `
# [Fund Name]

**As of [Current Date]**

# Investment Summary

---

## Manager & Key Terms Summary

### MANAGER SUMMARY

| Attribute | Details |
|-----------|---------|
| Firm Inception | [Year] |
| Headquarters | [City, Country] |
| Firm Assets | [Total AUM] |
| Website | [Website URL] |

### FUND & STRATEGY SUMMARY

| Attribute | Details |
|-----------|---------|
| Fund/Strategy Inception | [Year] |
| Fund/Strategy Assets | [Strategy AUM] |
| Asset Class | [Primary Asset Class] |
| Sub-Asset Class | [Specific Strategy Type] |
| Investment Focus | [Investment Focus Description] |
| Geographic Focus | [Geographic Regions] |
| Investment Term | [Term Structure] |
| Liquidity | [Liquidity Terms] |
| Distributions/Yield | [Distribution Policy] |
| Redemption Notice | [Notice Period] |
| Management Fee | [Fee Percentage] |
| Incentive Fee | [Performance Fee Structure] |
| GP Commitment | [GP Investment Amount] |
| Leverage | [Leverage Policy/Limits] |

---

## Executive Summary

[Firm Name] ("[Abbreviation]" or the "Firm") is a [description of firm type and focus].

[Overview paragraph describing the firm's market positioning, key differentiators, and investment approach.]

[Additional context on the specific fund/strategy being presented and rationale for investment consideration.]

---

## Investment Merits

**[Merit 1 Title]:** [Detailed explanation of competitive advantage with supporting evidence]

**[Merit 2 Title]:** [Detailed explanation of differentiated capability or positioning]

**[Merit 3 Title]:** [Detailed explanation of structural advantage or value driver]

**[Merit 4 Title]:** [Detailed explanation of additional investment merit]

---

## Investment Risks & Mitigants

**[Risk 1 Title]:** [Description of risk and corresponding mitigant]

**[Risk 2 Title]:** [Description of risk and corresponding mitigant]

**[Risk 3 Title]:** [Description of risk and corresponding mitigant]

**[Risk 4 Title]:** [Description of risk and corresponding mitigant]

---

## Track Record

[Performance summary and context.]

| Fund | MOIC | IRR |
|------|------|-----|
| [Fund 1] | [X.Xx] | [XX%] |
| [Fund 2] | [X.Xx] | [XX%] |
| [Fund 3] | [X.Xx] | [XX%] |

*Source: [Data Source]*

---
`;

export async function generateInvestmentMemo(context: MemoContext): Promise<{ title: string; content: string; templateType: MemoTemplateType }> {
  const { portfolio, holdings, riskMetrics, documents, templateType = "institutional" } = context;

  const documentSummaries = documents
    .filter(d => d.extractedContent)
    .map(d => `Document: ${d.fileName}\nType: ${d.documentType || 'Unknown'}\nContent Summary:\n${d.extractedContent?.substring(0, 2000)}...`)
    .join("\n\n---\n\n");

  const holdingsSummary = holdings.map(h => 
    `- ${h.fundName} (${h.assetClass}): $${parseFloat(h.marketValue).toLocaleString()} (${parseFloat(h.allocation).toFixed(1)}% allocation, YTD: ${h.returnYtd ? (parseFloat(h.returnYtd) * 100).toFixed(1) : 'N/A'}%)`
  ).join("\n");

  const riskSummary = riskMetrics ? `
Risk Metrics:
- Sharpe Ratio: ${riskMetrics.sharpeRatio}
- Volatility: ${(parseFloat(riskMetrics.volatility || "0") * 100).toFixed(2)}%
- VaR (95%): ${(parseFloat(riskMetrics.var95 || "0") * 100).toFixed(2)}%
- Max Drawdown: ${(parseFloat(riskMetrics.maxDrawdown || "0") * 100).toFixed(2)}%
- Beta: ${riskMetrics.beta}
- Alpha: ${riskMetrics.alpha}
` : "Risk metrics not available.";

  const template = templateType === "everest_investment_summary" 
    ? EVEREST_INVESTMENT_SUMMARY_TEMPLATE 
    : templateType === "verita_investment_memo"
    ? VERITA_INVESTMENT_MEMO_TEMPLATE
    : templateType === "investment_summary"
    ? INVESTMENT_SUMMARY_TEMPLATE
    : templateType === "verita_investment_summary"
    ? VERITA_INVESTMENT_SUMMARY_TEMPLATE
    : INSTITUTIONAL_TEMPLATE;

  const templateName = templateType === "everest_investment_summary" 
    ? "Everest Private Wealth Investment Summary" 
    : templateType === "verita_investment_memo"
    ? "Investment Memo"
    : templateType === "investment_summary"
    ? "Investment Summary"
    : templateType === "verita_investment_summary"
    ? "Verita Investment Summary"
    : "Executive Summary";

  const systemPrompt = `You are a seasoned investment professional with 20+ years of experience in institutional asset management, private equity, and alternative investments. You are preparing a formal investment memorandum to present to an Investment Committee for approval or ongoing monitoring purposes.

Your writing must reflect the perspective of a senior portfolio manager or chief investment officer addressing sophisticated institutional investors and fiduciaries. The document will be used for investment decision-making and must meet the highest standards of professional investment communication.

CRITICAL REQUIREMENTS:

1. PROFESSIONAL TONE & VOICE:
   - Write authoritatively as a seasoned investment professional, not as a junior analyst or AI assistant
   - Use precise, measured language that conveys confidence without overstatement
   - Employ investment industry terminology correctly and consistently
   - Maintain objectivity while providing clear investment rationale
   - Address the Investment Committee directly where appropriate (e.g., "We recommend...", "The Committee should note...")

2. GRAMMATICAL & STYLISTIC EXCELLENCE:
   - Ensure impeccable grammar, punctuation, and sentence structure throughout
   - Use active voice predominantly; reserve passive voice for appropriate contexts
   - Vary sentence structure for readability while maintaining professionalism
   - Avoid colloquialisms, hedging language, or informal expressions
   - Eliminate redundancy and ensure each sentence adds substantive value

3. CONTENT STRUCTURE:
   - Follow the "${templateName}" template structure exactly as provided
   - Format all tables and sections precisely using markdown syntax
   - Fill every placeholder with specific, relevant data from the source materials
   - When data is unavailable, provide reasonable estimates clearly marked as such

4. ANALYTICAL RIGOR:
   - Include specific quantitative metrics, thresholds, and benchmarks
   - Provide balanced analysis of both merits and risks with clear mitigants
   - Articulate clear investment rationale tied to portfolio objectives
   - Define specific, measurable criteria for ongoing monitoring and redemption triggers`;

  const userPrompt = `Prepare a formal ${templateName} for presentation to the Investment Committee. This document must be suitable for fiduciary review and investment decision-making.

INVESTMENT DETAILS:

Portfolio/Fund: ${portfolio.name}
Total Value: $${parseFloat(portfolio.totalValue).toLocaleString()}
Base Currency: ${portfolio.currency}
Strategy Overview: ${portfolio.description || "Multi-asset fund of funds portfolio"}

CURRENT PORTFOLIO COMPOSITION:
${holdingsSummary}

${riskSummary}

${documentSummaries ? `SUPPORTING DOCUMENTATION (Data Room Materials):
${documentSummaries}` : "Note: No additional data room materials were provided for this analysis."}

---

DOCUMENT REQUIREMENTS:

1. Follow the EXACT structure of the ${templateName} template provided below
2. Write from the perspective of a senior investment professional addressing the Investment Committee
3. Ensure all content is grammatically correct, professionally worded, and analytically rigorous
4. Replace all placeholder text with specific, substantive content derived from the source materials
5. Where specific data points are unavailable, provide reasonable professional estimates clearly identified as such
6. Include specific quantitative thresholds for monitoring and redemption triggers

TEMPLATE STRUCTURE TO FOLLOW:

${template}

Produce the complete memorandum now, ensuring it meets institutional investment standards.`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content || "Failed to generate memo content.";
  
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const title = templateType === "everest_investment_summary" 
    ? `Everest Investment Summary - ${portfolio.name} - ${today}`
    : templateType === "verita_investment_memo" 
    ? `Investment Memo - ${portfolio.name} - ${today}`
    : templateType === "investment_summary"
    ? `Investment Summary - ${portfolio.name} - ${today}`
    : templateType === "verita_investment_summary"
    ? `Verita Investment Summary - ${portfolio.name} - ${today}`
    : `Executive Summary - ${portfolio.name} - ${today}`;

  return { title, content, templateType };
}

export async function analyzeDocumentContent(
  fileName: string,
  content: string,
  fileType: string
): Promise<{ extractedContent: string; documentType: string }> {
  const systemPrompt = `You are a financial document analyst. Analyze the provided document content and:
1. Identify the type of document (e.g., financial statements, fund fact sheet, quarterly report, due diligence report, etc.)
2. Extract key financial information, metrics, and insights
3. Summarize the most important points relevant for investment analysis

Be concise but comprehensive. Focus on actionable information.`;

  const userPrompt = `Analyze this document:
File Name: ${fileName}
File Type: ${fileType}

Content:
${content.substring(0, 8000)}

Provide:
1. Document Type: [identify the document type]
2. Key Findings: [list the most important information]
3. Financial Metrics: [any numbers, returns, values mentioned]
4. Investment Implications: [what this means for investment decisions]`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 2048,
  });

  const analysisContent = response.choices[0]?.message?.content || "";
  
  const documentTypeMatch = analysisContent.match(/Document Type:\s*(.+?)(?:\n|$)/i);
  const documentType = documentTypeMatch ? documentTypeMatch[1].trim() : "General Document";

  return {
    extractedContent: analysisContent,
    documentType,
  };
}
