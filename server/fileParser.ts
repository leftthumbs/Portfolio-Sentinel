import * as XLSX from "xlsx";
import mammoth from "mammoth";
import type { InsertHolding } from "@shared/schema";

export interface ParsedInvestment {
  fundName: string;
  ticker?: string;
  assetClass: string;
  marketValue: number;
  costBasis?: number;
  allocation?: number;
}

const ASSET_CLASS_KEYWORDS: Record<string, string[]> = {
  "Equity": ["equity", "stock", "shares", "etf", "index", "growth", "value", "large cap", "small cap", "mid cap", "emerging"],
  "Fixed Income": ["bond", "fixed income", "treasury", "corporate", "municipal", "high yield", "investment grade", "debt"],
  "Real Estate": ["real estate", "reit", "property", "mortgage"],
  "Alternatives": ["alternative", "hedge", "private equity", "venture", "commodity", "infrastructure"],
  "Cash": ["cash", "money market", "short term", "liquidity"],
};

function detectAssetClass(text: string): string {
  const lowerText = text.toLowerCase();
  for (const [assetClass, keywords] of Object.entries(ASSET_CLASS_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return assetClass;
      }
    }
  }
  return "Equity";
}

function parseNumber(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    let str = value.trim();
    const isNegative = str.startsWith("(") && str.endsWith(")");
    str = str.replace(/[$,\s%]/g, "").replace(/[()]/g, "");
    const num = parseFloat(str);
    if (isNaN(num)) return 0;
    return isNegative ? -num : num;
  }
  return 0;
}

function findColumnIndex(headers: string[], possibleNames: string[]): number {
  const headerLower = headers.map(h => (h || "").toString().toLowerCase().trim());
  for (const name of possibleNames) {
    const index = headerLower.findIndex(h => h.includes(name.toLowerCase()));
    if (index !== -1) return index;
  }
  return -1;
}

export function parseExcel(buffer: Buffer): ParsedInvestment[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const investments: ParsedInvestment[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
    
    if (data.length < 2) continue;

    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i] as any[];
      if (row && row.some((cell: any) => {
        const str = (cell || "").toString().toLowerCase();
        return str.includes("fund") || str.includes("name") || str.includes("investment") || str.includes("security");
      })) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = (data[headerRowIndex] as string[]) || [];
    
    const nameCol = findColumnIndex(headers, ["fund", "name", "investment", "security", "holding", "description"]);
    const tickerCol = findColumnIndex(headers, ["ticker", "symbol", "cusip", "isin"]);
    const assetClassCol = findColumnIndex(headers, ["asset class", "type", "category", "sector", "asset type"]);
    const valueCol = findColumnIndex(headers, ["market value", "value", "current value", "amount", "balance", "nav"]);
    const costCol = findColumnIndex(headers, ["cost", "cost basis", "book value", "purchase"]);
    const allocationCol = findColumnIndex(headers, ["allocation", "weight", "%", "percent"]);

    if (nameCol === -1 || valueCol === -1) continue;

    for (let i = headerRowIndex + 1; i < data.length; i++) {
      const row = data[i] as any[];
      if (!row || !row[nameCol]) continue;

      const fundName = (row[nameCol] || "").toString().trim();
      if (!fundName || fundName.toLowerCase() === "total" || fundName.toLowerCase().includes("total")) continue;

      const marketValue = parseNumber(row[valueCol]);
      if (marketValue <= 0) continue;

      const investment: ParsedInvestment = {
        fundName,
        ticker: tickerCol !== -1 ? (row[tickerCol] || "").toString().trim() : undefined,
        assetClass: assetClassCol !== -1 ? (row[assetClassCol] || "").toString().trim() : detectAssetClass(fundName),
        marketValue,
        costBasis: costCol !== -1 ? parseNumber(row[costCol]) : undefined,
        allocation: allocationCol !== -1 ? parseNumber(row[allocationCol]) : undefined,
      };

      if (!investment.assetClass) {
        investment.assetClass = detectAssetClass(fundName);
      }

      investments.push(investment);
    }
  }

  return investments;
}

export async function parsePDF(buffer: Buffer): Promise<ParsedInvestment[]> {
  const investments: ParsedInvestment[] = [];
  
  try {
    const pdfParseModule = await import("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default || pdfParseModule;
    const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const parser = new PDFParse(uint8Array);
    await parser.load();
    const result = await parser.getText();
    const text = typeof result === 'string' ? result : (result?.text || '');
    const lines = text.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    
    const valuePattern = /\$?\s*[\d,]+\.?\d*\s*(?:USD|EUR|GBP)?/gi;
    const tickerPattern = /\b[A-Z]{2,5}\b/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      const values = line.match(valuePattern);
      if (!values || values.length === 0) continue;

      const marketValue = parseNumber(values[0]);
      if (marketValue < 1000) continue;

      const tickers = line.match(tickerPattern);
      const ticker = tickers && tickers.length > 0 ? tickers[0] : undefined;

      let fundName = line.replace(valuePattern, "").replace(tickerPattern, "").trim();
      fundName = fundName.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();
      
      if (fundName.length < 3 || fundName.toLowerCase().includes("total")) continue;

      const investment: ParsedInvestment = {
        fundName: fundName.substring(0, 100),
        ticker,
        assetClass: detectAssetClass(fundName),
        marketValue,
        costBasis: values.length > 1 ? parseNumber(values[1]) : undefined,
      };

      investments.push(investment);
    }
  } catch (error) {
    console.error("PDF parsing error:", error);
  }

  return investments;
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const pdfParseModule = await import("pdf-parse");
    const PDFParse = (pdfParseModule as any).PDFParse || (pdfParseModule as any).default || pdfParseModule;
    const uint8Array = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const parser = new PDFParse(uint8Array);
    await parser.load();
    const result = await parser.getText();
    const text = typeof result === 'string' ? result : (result?.text || '');
    return text;
  } catch (error) {
    console.error("PDF text extraction error:", error);
    return "";
  }
}

export function extractExcelText(buffer: Buffer): string {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
      
      for (const row of data) {
        if (Array.isArray(row)) {
          const rowText = row.map((cell: any) => (cell || "").toString().trim()).filter(Boolean).join(" | ");
          if (rowText) textParts.push(rowText);
        }
      }
    }
    
    return textParts.join("\n");
  } catch (error) {
    console.error("Excel text extraction error:", error);
    return "";
  }
}

export function extractCsvText(buffer: Buffer): string {
  try {
    const text = buffer.toString("utf-8");
    return text;
  } catch (error) {
    console.error("CSV text extraction error:", error);
    return "";
  }
}

export async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  } catch (error) {
    console.error("DOCX text extraction error:", error);
    return "";
  }
}

export function convertToHoldings(
  investments: ParsedInvestment[],
  portfolioId: string
): InsertHolding[] {
  const totalValue = investments.reduce((sum, inv) => sum + inv.marketValue, 0);

  return investments.map(inv => {
    const costBasis = inv.costBasis || inv.marketValue;
    return {
      portfolioId,
      fundName: inv.fundName,
      ticker: inv.ticker || null,
      assetClass: inv.assetClass,
      allocation: inv.allocation?.toString() || ((inv.marketValue / totalValue) * 100).toFixed(2),
      marketValue: inv.marketValue.toFixed(2),
      costBasis: costBasis.toFixed(2),
      unrealizedGain: (inv.marketValue - costBasis).toFixed(2),
      returnYtd: undefined,
      return1yr: undefined,
      return3yr: undefined,
    };
  });
}
