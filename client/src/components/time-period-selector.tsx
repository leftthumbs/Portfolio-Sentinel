import { Button } from "@/components/ui/button";

export type TimePeriod = "YTD" | "LTM" | "1Y" | "3Y" | "5Y" | "10Y" | "SI";

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  className?: string;
}

const TIME_PERIODS: { value: TimePeriod; label: string; tooltip: string }[] = [
  { value: "YTD", label: "YTD", tooltip: "Year to Date" },
  { value: "LTM", label: "LTM", tooltip: "Last Twelve Months" },
  { value: "1Y", label: "1Y", tooltip: "1 Year" },
  { value: "3Y", label: "3Y", tooltip: "3 Years" },
  { value: "5Y", label: "5Y", tooltip: "5 Years" },
  { value: "10Y", label: "10Y", tooltip: "10 Years" },
  { value: "SI", label: "SI", tooltip: "Since Inception" },
];

export function TimePeriodSelector({ value, onChange, className }: TimePeriodSelectorProps) {
  return (
    <div className={`flex items-center gap-1 ${className || ""}`} data-testid="time-period-selector">
      {TIME_PERIODS.map((period) => (
        <Button
          key={period.value}
          variant={value === period.value ? "default" : "ghost"}
          size="sm"
          onClick={() => onChange(period.value)}
          title={period.tooltip}
          data-testid={`button-time-${period.value}`}
        >
          {period.label}
        </Button>
      ))}
    </div>
  );
}

export function getTimePeriodStartDate(period: TimePeriod, inceptionDate?: Date): Date {
  const now = new Date();
  
  switch (period) {
    case "YTD":
      return new Date(now.getFullYear(), 0, 1);
    case "LTM":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "1Y":
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case "3Y":
      return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    case "5Y":
      return new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    case "10Y":
      return new Date(now.getFullYear() - 10, now.getMonth(), now.getDate());
    case "SI":
      return inceptionDate || new Date(2000, 0, 1);
    default:
      return new Date(now.getFullYear(), 0, 1);
  }
}

export function filterDataByTimePeriod<T extends { date: string | Date }>(
  data: T[],
  period: TimePeriod,
  inceptionDate?: Date
): T[] {
  const startDate = getTimePeriodStartDate(period, inceptionDate);
  return data.filter((item) => new Date(item.date) >= startDate);
}

export function getTimePeriodLabel(period: TimePeriod): string {
  const found = TIME_PERIODS.find((p) => p.value === period);
  return found ? (period === "SI" ? "Since Inception" : found.label) : period;
}

export { TIME_PERIODS };
