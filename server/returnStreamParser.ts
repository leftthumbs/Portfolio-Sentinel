/**
 * Return Stream Parser
 *
 * Parses an uploaded manager/fund return stream (CSV or Excel) into a set of
 * aligned, date-indexed numeric series. A "return stream" in practice arrives in
 * many shapes, so this module is deliberately forgiving:
 *
 *   - Date column can be named anything (Date, Period, Month, As of, ...) or be
 *     the first column; values may be ISO dates, Excel serials, "Jan-19",
 *     "2019-01", "Q1 2019", or "3/31/2019".
 *   - Value columns may be periodic returns in percent ("1.24%", "1.24"),
 *     periodic returns in decimal (0.0124), or NAV / index levels (100.00).
 *   - Multiple series may be present (fund + benchmark + peer), so every numeric
 *     column is returned and the caller picks which is the manager and which is
 *     the benchmark.
 *
 * Detection is a best-effort default. The UI always lets the user override the
 * interpretation of a column, because silently misreading percent as decimal is
 * a 100x error in every downstream statistic.
 */

export type ColumnKind = "returnPercent" | "returnDecimal" | "level";

export interface ParsedColumn {
  /** Header text as it appeared in the file. */
  name: string;
  /** Zero-based index of the column within the source file. */
  index: number;
  /** Auto-detected interpretation; the client may override it. */
  detectedKind: ColumnKind;
  /** Why the detector chose that kind — surfaced in the UI for transparency. */
  detectionReason: string;
  /** Raw numeric values exactly as they appear in the file, null where blank. */
  rawValues: (number | null)[];
  /** Fraction of rows that carried a usable number. */
  coverage: number;
}

export interface ParsedReturnFile {
  /** ISO-8601 (yyyy-mm-dd) period end dates, ascending, one per row. */
  dates: string[];
  columns: ParsedColumn[];
  rowCount: number;
  /** Rows dropped because the date could not be understood. */
  skippedRows: number;
  warnings: string[];
  detectedFrequency: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
  periodsPerYear: number;
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/** Excel stores dates as days since 1899-12-30 (the 1900 leap-year bug included). */
function excelSerialToDate(serial: number): Date | null {
  if (!isFinite(serial) || serial < 1 || serial > 200000) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/** Last calendar day of the given month, which is the natural period end. */
function endOfMonth(year: number, monthIndex: number): Date {
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Parses the many shapes a period label takes in fund tear sheets.
 * Returns the period END date so that monthly "Jan-2019" sorts and aligns with
 * a benchmark series stamped 2019-01-31.
 */
export function parsePeriodDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    // Bare 4-digit years show up in annual return streams.
    if (Number.isInteger(value) && value >= 1900 && value <= 2200) {
      return endOfMonth(value, 11);
    }
    return excelSerialToDate(value);
  }

  const raw = String(value).trim().replace(/^﻿/, "");
  if (!raw) return null;

  // "Q1 2019", "2019 Q1", "2019Q1"
  const quarter = raw.match(/^(?:Q([1-4])[\s\-/]*(\d{4})|(\d{4})[\s\-/]*Q([1-4]))$/i);
  if (quarter) {
    const q = parseInt(quarter[1] ?? quarter[4], 10);
    const y = parseInt(quarter[2] ?? quarter[3], 10);
    return endOfMonth(y, q * 3 - 1);
  }

  // "Jan-19", "Jan 2019", "January 2019"
  const monthName = raw.match(/^([A-Za-z]{3,9})[\s\-/,]+(\d{2,4})$/);
  if (monthName) {
    const m = MONTHS[monthName[1].toLowerCase()];
    if (m !== undefined) {
      let y = parseInt(monthName[2], 10);
      if (y < 100) y += y < 50 ? 2000 : 1900;
      return endOfMonth(y, m);
    }
  }

  // "2019-Jan", "2019 January"
  const yearMonthName = raw.match(/^(\d{4})[\s\-/,]+([A-Za-z]{3,9})$/);
  if (yearMonthName) {
    const m = MONTHS[yearMonthName[2].toLowerCase()];
    if (m !== undefined) return endOfMonth(parseInt(yearMonthName[1], 10), m);
  }

  // "2019-01" / "2019/01" (no day component)
  const yearMonth = raw.match(/^(\d{4})[\-/](\d{1,2})$/);
  if (yearMonth) {
    const m = parseInt(yearMonth[2], 10) - 1;
    if (m >= 0 && m <= 11) return endOfMonth(parseInt(yearMonth[1], 10), m);
  }

  // "2019-01-31" — parse as UTC so a negative local offset cannot roll it back a day.
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  // "1/31/2019" and "31/01/2019" — disambiguated by which component exceeds 12.
  const slashed = raw.match(/^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})$/);
  if (slashed) {
    let a = +slashed[1];
    let b = +slashed[2];
    let y = +slashed[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const [month, day] = b > 12 && a <= 12 ? [a, b] : a > 12 ? [b, a] : [a, b];
    const d = new Date(Date.UTC(y, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }

  // Bare year in a string cell.
  if (/^\d{4}$/.test(raw)) {
    const y = parseInt(raw, 10);
    if (y >= 1900 && y <= 2200) return endOfMonth(y, 11);
  }

  const fallback = new Date(raw);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export interface NumericCell {
  value: number | null;
  hadPercentSign: boolean;
}

/**
 * Parses a numeric cell, tolerating thousands separators, currency symbols,
 * accounting negatives "(1.24)", trailing percent signs, and em-dash blanks.
 */
export function parseNumericCell(value: unknown): NumericCell {
  if (value === null || value === undefined) return { value: null, hadPercentSign: false };
  if (typeof value === "number") {
    return { value: isFinite(value) ? value : null, hadPercentSign: false };
  }

  let str = String(value).trim().replace(/^﻿/, "");
  if (!str || /^(n\/?a|nil|null|-{1,2}|—|–|\.)$/i.test(str)) {
    return { value: null, hadPercentSign: false };
  }

  const hadPercentSign = str.includes("%");
  str = str.replace(/%/g, "");

  let negative = false;
  const accounting = str.match(/^\((.*)\)$/);
  if (accounting) {
    negative = true;
    str = accounting[1];
  }

  str = str.replace(/[$£€¥\s]/g, "").replace(/,/g, "");
  if (str.startsWith("+")) str = str.slice(1);

  const num = parseFloat(str);
  if (!isFinite(num)) return { value: null, hadPercentSign };
  return { value: negative ? -num : num, hadPercentSign };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const LEVEL_HEADER_HINT = /\b(nav|index|level|price|value|balance|equity|aum|wealth|growth of)\b/i;
const RETURN_HEADER_HINT = /\b(return|ret|perf|performance|pnl|p&l|gain|yield|change|chg|%)\b/i;

/**
 * Chooses how to interpret a numeric column.
 *
 * Ordering matters: an explicit "%" in a cell or header is definitive, a header
 * naming NAV/index beats shape heuristics, and only then do we fall back to the
 * magnitude of the numbers themselves.
 */
export function detectColumnKind(
  header: string,
  values: (number | null)[],
  anyPercentSign: boolean
): { kind: ColumnKind; reason: string } {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return { kind: "returnDecimal", reason: "No numeric values found" };
  }

  if (anyPercentSign) {
    return { kind: "returnPercent", reason: "Cells contain a % sign" };
  }
  if (header.includes("%")) {
    return { kind: "returnPercent", reason: "Header is labelled with %" };
  }

  const allPositive = present.every((v) => v > 0);
  const absValues = present.map(Math.abs);
  const medianAbs = median(absValues);
  const maxAbs = Math.max(...absValues);

  // Period-over-period moves: a level series drifts slowly, a return series does not.
  const stepChanges: number[] = [];
  for (let i = 1; i < present.length; i++) {
    if (present[i - 1] !== 0) {
      stepChanges.push(Math.abs(present[i] / present[i - 1] - 1));
    }
  }
  const medianStep = median(stepChanges);

  const headerSaysLevel = LEVEL_HEADER_HINT.test(header) && !RETURN_HEADER_HINT.test(header);
  const looksLikeLevel = allPositive && medianAbs > 5 && medianStep < 0.35;

  if (headerSaysLevel && allPositive) {
    return { kind: "level", reason: `Header "${header}" names a NAV/index level` };
  }
  if (looksLikeLevel) {
    return {
      kind: "level",
      reason: `All values positive, median ${medianAbs.toFixed(1)} with small period-over-period steps`,
    };
  }

  // Anything above ~25% per period read as a decimal would be implausible for a
  // fund return stream, so treat the column as percent-denominated.
  if (medianAbs > 0.25 || maxAbs > 3) {
    return {
      kind: "returnPercent",
      reason: `Median magnitude ${medianAbs.toFixed(2)} is too large for decimal returns`,
    };
  }

  return {
    kind: "returnDecimal",
    reason: `Median magnitude ${medianAbs.toFixed(4)} is consistent with decimal returns`,
  };
}

/** Converts a column's raw values into periodic decimal returns. */
export function columnToReturns(rawValues: (number | null)[], kind: ColumnKind): (number | null)[] {
  if (kind === "returnPercent") return rawValues.map((v) => (v === null ? null : v / 100));
  if (kind === "returnDecimal") return rawValues.slice();

  // Levels: the first period has no prior mark, so it yields no return.
  const out: (number | null)[] = [null];
  for (let i = 1; i < rawValues.length; i++) {
    const prev = rawValues[i - 1];
    const curr = rawValues[i];
    out.push(prev !== null && curr !== null && prev !== 0 ? curr / prev - 1 : null);
  }
  return out;
}

export function detectFrequency(dates: string[]): {
  frequency: ParsedReturnFile["detectedFrequency"];
  periodsPerYear: number;
} {
  if (dates.length < 2) return { frequency: "monthly", periodsPerYear: 12 };

  const times = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push((times[i] - times[i - 1]) / 86400000);
  }
  const medianGap = median(gaps);

  if (medianGap <= 4) return { frequency: "daily", periodsPerYear: 252 };
  if (medianGap <= 10) return { frequency: "weekly", periodsPerYear: 52 };
  if (medianGap <= 45) return { frequency: "monthly", periodsPerYear: 12 };
  if (medianGap <= 130) return { frequency: "quarterly", periodsPerYear: 4 };
  return { frequency: "annual", periodsPerYear: 1 };
}

/** Locates the column holding period labels. */
function findDateColumn(headers: string[], rows: unknown[][]): number {
  const named = headers.findIndex((h) =>
    /\b(date|period|month|quarter|year|as of|asof|time|timestamp)\b/i.test(h)
  );
  if (named >= 0) return named;

  // Otherwise pick whichever column parses as dates most often.
  let bestIndex = 0;
  let bestScore = -1;
  const sample = rows.slice(0, 40);
  for (let c = 0; c < headers.length; c++) {
    let score = 0;
    for (const row of sample) {
      if (parsePeriodDate(row[c]) !== null) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = c;
    }
  }
  return bestIndex;
}

/**
 * Finds the header row. Fund tear sheets frequently carry a title and blank
 * lines above the actual table, so we take the first row that has at least two
 * non-empty cells and is followed by a row whose date column parses.
 */
function findHeaderRow(grid: unknown[][]): number {
  for (let r = 0; r < Math.min(grid.length - 1, 25); r++) {
    const row = grid[r] ?? [];
    const filled = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (filled.length < 2) continue;

    // A header row's own cells should mostly NOT parse as numbers.
    const numericCells = filled.filter((c) => parseNumericCell(c).value !== null).length;
    if (numericCells > filled.length / 2) continue;

    const next = grid[r + 1] ?? [];
    const nextHasDate = next.some((c) => parsePeriodDate(c) !== null);
    const nextHasNumber = next.some((c) => parseNumericCell(c).value !== null);
    if (nextHasDate && nextHasNumber) return r;
  }
  return 0;
}

/** Shared conversion from a raw cell grid to the parsed, date-aligned result. */
export function gridToReturnFile(grid: unknown[][]): ParsedReturnFile {
  const warnings: string[] = [];

  const nonEmpty = grid.filter(
    (row) => Array.isArray(row) && row.some((c) => c !== null && c !== undefined && String(c).trim() !== "")
  );
  if (nonEmpty.length < 3) {
    throw new Error("File needs a header row and at least two periods of data.");
  }

  const headerRowIndex = findHeaderRow(nonEmpty);
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const rawHeaders = nonEmpty[headerRowIndex] ?? [];
  const headers: string[] = [];
  for (let c = 0; c < width; c++) {
    const h = rawHeaders[c];
    const text = h === null || h === undefined ? "" : String(h).trim();
    headers.push(text || `Column ${c + 1}`);
  }

  const bodyRows = nonEmpty.slice(headerRowIndex + 1);
  const dateCol = findDateColumn(headers, bodyRows);

  const dates: string[] = [];
  const keptRows: unknown[][] = [];
  let skippedRows = 0;
  const seenDates = new Set<string>();
  let duplicateDates = 0;

  for (const row of bodyRows) {
    const parsedDate = parsePeriodDate(row[dateCol]);
    if (!parsedDate) {
      skippedRows++;
      continue;
    }
    // A row with a date but no numbers anywhere is a section divider, not data.
    const hasNumber = row.some((cell, i) => i !== dateCol && parseNumericCell(cell).value !== null);
    if (!hasNumber) {
      skippedRows++;
      continue;
    }
    const iso = toIsoDate(parsedDate);
    if (seenDates.has(iso)) {
      duplicateDates++;
      continue;
    }
    seenDates.add(iso);
    dates.push(iso);
    keptRows.push(row);
  }

  if (dates.length < 2) {
    throw new Error(
      "Could not read at least two dated periods. Check that one column holds dates and another holds returns."
    );
  }

  // Sort chronologically; uploads are often newest-first.
  const wasOutOfOrder = dates.some((d, i) => i > 0 && d < dates[i - 1]);
  const order = dates.map((_, i) => i).sort((a, b) => dates[a].localeCompare(dates[b]));
  const sortedDates = order.map((i) => dates[i]);
  const sortedRows = order.map((i) => keptRows[i]);
  if (wasOutOfOrder) {
    warnings.push("Rows were reordered to run oldest to newest.");
  }

  const columns: ParsedColumn[] = [];
  for (let c = 0; c < width; c++) {
    if (c === dateCol) continue;

    const rawValues: (number | null)[] = [];
    let anyPercentSign = false;
    let present = 0;
    for (const row of sortedRows) {
      const cell = parseNumericCell(row[c]);
      if (cell.hadPercentSign) anyPercentSign = true;
      if (cell.value !== null) present++;
      rawValues.push(cell.value);
    }
    if (present < 2) continue;

    const { kind, reason } = detectColumnKind(headers[c], rawValues, anyPercentSign);
    columns.push({
      name: headers[c],
      index: c,
      detectedKind: kind,
      detectionReason: reason,
      rawValues,
      coverage: present / sortedRows.length,
    });
  }

  if (columns.length === 0) {
    throw new Error("No numeric return or NAV column was found alongside the date column.");
  }

  if (skippedRows > 0) {
    warnings.push(`${skippedRows} row${skippedRows === 1 ? "" : "s"} skipped (unreadable date or no numeric value).`);
  }
  if (duplicateDates > 0) {
    warnings.push(`${duplicateDates} duplicate date${duplicateDates === 1 ? "" : "s"} dropped; the first occurrence was kept.`);
  }
  for (const col of columns) {
    if (col.coverage < 1) {
      warnings.push(`Column "${col.name}" is missing values in ${Math.round((1 - col.coverage) * 100)}% of periods.`);
    }
  }

  const { frequency, periodsPerYear } = detectFrequency(sortedDates);

  return {
    dates: sortedDates,
    columns,
    rowCount: sortedDates.length,
    skippedRows,
    warnings,
    detectedFrequency: frequency,
    periodsPerYear,
  };
}

export function parseReturnStreamCsv(text: string): ParsedReturnFile {
  const cleaned = text.replace(/^﻿/, "");
  const delimiter = pickDelimiter(cleaned);
  const grid = splitDelimited(cleaned, delimiter);
  return gridToReturnFile(grid);
}

/** Picks the delimiter that yields the most consistent column count. */
function pickDelimiter(text: string): string {
  const candidates = [",", ";", "\t", "|"];
  const sample = text.split(/\r?\n/).slice(0, 20).filter((l) => l.trim());
  let best = ",";
  let bestScore = -1;
  for (const delim of candidates) {
    const counts = sample.map((line) => line.split(delim).length);
    const maxCount = Math.max(...counts, 0);
    if (maxCount < 2) continue;
    const modal = counts.filter((c) => c === maxCount).length;
    const score = maxCount * 10 + modal;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

/** Minimal RFC-4180 splitter: handles quoted fields containing delimiters. */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);

  return rows;
}

export async function parseReturnStreamExcel(buffer: Buffer): Promise<ParsedReturnFile> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

  // Try every sheet and keep the one that yields the longest usable series —
  // fund workbooks often lead with a cover sheet.
  let best: ParsedReturnFile | null = null;
  let lastError: Error | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      blankrows: false,
      defval: null,
    }) as unknown[][];

    try {
      const parsed = gridToReturnFile(grid);
      if (!best || parsed.rowCount > best.rowCount) {
        best = workbook.SheetNames.length > 1
          ? { ...parsed, warnings: [...parsed.warnings, `Read sheet "${sheetName}".`] }
          : parsed;
      }
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (!best) {
    throw lastError ?? new Error("No sheet in the workbook contained a readable return stream.");
  }
  return best;
}

export async function parseReturnStreamFile(
  fileName: string,
  buffer: Buffer
): Promise<ParsedReturnFile> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    return parseReturnStreamExcel(buffer);
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) {
    return parseReturnStreamCsv(buffer.toString("utf-8"));
  }
  throw new Error("Unsupported file type. Upload a CSV, TSV, or Excel file of periodic returns or NAVs.");
}

export interface AlignedSeries {
  dates: string[];
  returns: number[];
  benchmarkReturns: number[] | null;
  /** Periods removed because the fund (or benchmark) had no usable value. */
  droppedPeriods: number;
  notes: string[];
}

/**
 * Converts the chosen columns into decimal returns and trims the result to the
 * periods where everything needed is present.
 *
 * Two cases force periods to be dropped: a NAV/level column yields no return in
 * its first period, and blank cells leave holes. Dropping keeps the fund and
 * benchmark on exactly the same dates, which every relative statistic assumes.
 */
export function buildAlignedSeries(
  dates: string[],
  fundRaw: (number | null)[],
  fundKind: ColumnKind,
  benchmarkRaw?: (number | null)[] | null,
  benchmarkKind?: ColumnKind | null
): AlignedSeries {
  const notes: string[] = [];
  const fundReturns = columnToReturns(fundRaw, fundKind);
  const benchmarkReturns =
    benchmarkRaw && benchmarkKind ? columnToReturns(benchmarkRaw, benchmarkKind) : null;

  if (fundKind === "level") {
    notes.push("The first period was consumed as the opening NAV, so it produces no return.");
  }

  const outDates: string[] = [];
  const outFund: number[] = [];
  const outBench: number[] = [];
  let dropped = 0;

  for (let i = 0; i < dates.length; i++) {
    const f = fundReturns[i];
    const b = benchmarkReturns ? benchmarkReturns[i] : null;
    if (f === null || !isFinite(f) || (benchmarkReturns && (b === null || !isFinite(b)))) {
      dropped++;
      continue;
    }
    outDates.push(dates[i]);
    outFund.push(f);
    if (benchmarkReturns) outBench.push(b as number);
  }

  // Only mention holes beyond the expected NAV-conversion loss.
  const expectedDrop = fundKind === "level" || benchmarkKind === "level" ? 1 : 0;
  if (dropped > expectedDrop) {
    notes.push(
      `${dropped - expectedDrop} period${dropped - expectedDrop === 1 ? "" : "s"} dropped for missing fund or benchmark values.`
    );
  }

  return {
    dates: outDates,
    returns: outFund,
    benchmarkReturns: benchmarkReturns ? outBench : null,
    droppedPeriods: dropped,
    notes,
  };
}
