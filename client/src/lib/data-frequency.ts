export type DataFrequency = "daily" | "weekly" | "monthly" | "quarterly";

export function detectDataFrequency(dates: (string | Date)[]): DataFrequency {
  if (dates.length === 0) return "daily";

  const sorted = dates
    .map(d => new Date(d).getTime())
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  if (sorted.length < 2) return "daily";

  const gaps: number[] = [];
  for (let i = 1; i < Math.min(sorted.length, 50); i++) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }

  if (gaps.length === 0) return "daily";

  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  const medianDays = medianGap / (1000 * 60 * 60 * 24);

  if (medianDays <= 3) return "daily";
  if (medianDays <= 10) return "weekly";
  if (medianDays <= 65) return "monthly";
  return "quarterly";
}

export function getFrequencyLabel(freq: DataFrequency): string {
  switch (freq) {
    case "daily": return "Daily";
    case "weekly": return "Weekly";
    case "monthly": return "Monthly";
    case "quarterly": return "Quarterly";
  }
}

export function getPeriodLabel(freq: DataFrequency): string {
  switch (freq) {
    case "daily": return "Day";
    case "weekly": return "Week";
    case "monthly": return "Month";
    case "quarterly": return "Quarter";
  }
}

export function getPeriodsPerYear(freq: DataFrequency): number {
  switch (freq) {
    case "daily": return 252;
    case "weekly": return 52;
    case "monthly": return 12;
    case "quarterly": return 4;
  }
}

export function getRecentPeriodCount(freq: DataFrequency): number {
  switch (freq) {
    case "daily": return 60;
    case "weekly": return 52;
    case "monthly": return 36;
    case "quarterly": return 12;
  }
}

export function formatDateForFrequency(date: string | Date, freq: DataFrequency): string {
  const d = new Date(date);
  switch (freq) {
    case "daily":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "weekly":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    case "monthly":
      return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    case "quarterly":
      const quarter = Math.ceil((d.getMonth() + 1) / 3);
      return `Q${quarter} ${d.getFullYear().toString().slice(-2)}`;
  }
}

export function formatDateFullForFrequency(date: string | Date, freq: DataFrequency): string {
  const d = new Date(date);
  switch (freq) {
    case "daily":
    case "weekly":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    case "monthly":
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    case "quarterly":
      const quarter = Math.ceil((d.getMonth() + 1) / 3);
      return `Q${quarter} ${d.getFullYear()}`;
  }
}

export function getXAxisTickInterval(dataLength: number, freq: DataFrequency): number | "preserveStartEnd" {
  if (dataLength <= 1) return 0;
  if (freq === "daily") {
    if (dataLength <= 30) return 2;
    if (dataLength <= 90) return 6;
    if (dataLength <= 180) return 14;
    return Math.floor(dataLength / 12);
  }
  if (freq === "weekly") {
    if (dataLength <= 13) return 0;
    if (dataLength <= 26) return 1;
    if (dataLength <= 52) return 3;
    return Math.floor(dataLength / 12);
  }
  if (freq === "monthly") {
    if (dataLength <= 12) return 0;
    if (dataLength <= 36) return 2;
    if (dataLength <= 60) return 4;
    return Math.floor(dataLength / 12);
  }
  if (dataLength <= 20) return 0;
  return "preserveStartEnd";
}
