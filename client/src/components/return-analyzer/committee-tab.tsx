/**
 * Investment Committee tab: the recommendation, the scorecard behind it, the
 * red flags, and the memo.
 *
 * The scoring is shown open — every pillar can be expanded to its individual
 * drivers with the value that produced each sub-score. A committee should be
 * able to disagree with a specific threshold rather than with a black box.
 */

import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Analytics, ICAssessment } from "@/lib/return-analytics-types";
import {
  SEVERITY_STYLES,
  STATUS_STYLES,
  VERDICT_STYLES,
  barColorForScore,
  downloadFile,
  fmtPercent,
  scoreBandLabel,
  slugify,
  toneForScore,
} from "@/lib/return-analytics-format";
import { SectionCard } from "./shared";
import { cn } from "@/lib/utils";

/**
 * Score bar coloured by band. Kept local because the shared Progress component
 * hardcodes its indicator to the primary colour.
 *
 * The colour is a redundant encoding — the numeric score and its band label sit
 * beside it — so the bar never carries meaning on its own.
 */
function ScoreBar({ score }: { score: number }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`Score ${score.toFixed(0)} out of 100 — ${scoreBandLabel(score)}`}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, score))}%`, backgroundColor: barColorForScore(score) }}
      />
    </div>
  );
}

function VerdictIcon({ verdict }: { verdict: ICAssessment["verdict"] }) {
  const cls = cn("h-7 w-7", VERDICT_STYLES[verdict].icon);
  if (verdict === "Strong Recommend" || verdict === "Recommend") return <CheckCircle2 className={cls} />;
  if (verdict === "Do Not Recommend") return <XCircle className={cls} />;
  if (verdict === "Recommend with Conditions") return <ShieldAlert className={cls} />;
  return <AlertTriangle className={cls} />;
}

export function CommitteeTab({
  analytics,
  assessment,
}: {
  analytics: Analytics;
  assessment: ICAssessment;
}) {
  const { toast } = useToast();
  const [showMemo, setShowMemo] = useState(false);
  const style = VERDICT_STYLES[assessment.verdict];
  const baseName = slugify(analytics.meta.fundName);

  const handleCopyMemo = async () => {
    try {
      await navigator.clipboard.writeText(assessment.memo);
      toast({ title: "Memo copied", description: "The full memorandum is on your clipboard." });
    } catch {
      toast({
        title: "Could not copy",
        description: "Your browser blocked clipboard access. Use Download instead.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className={cn("rounded-lg border-2 bg-card p-6", style.ring)} data-testid="card-verdict">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <VerdictIcon verdict={assessment.verdict} />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-sm font-semibold", style.badge)} data-testid="badge-verdict">
                  {assessment.verdict}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Confidence: {assessment.confidence}
                </Badge>
              </div>
              <h3 className="text-lg font-semibold">{analytics.meta.fundName}</h3>
              <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{assessment.verdictRationale}</p>
              <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
                <span className="font-medium">Confidence rationale:</span> {assessment.confidenceReason}
              </p>
            </div>
          </div>

          <div className="shrink-0 rounded-lg border bg-muted/30 p-4 text-center" data-testid="card-composite-score">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Composite score</div>
            <div className={cn("text-5xl font-bold tabular-nums", toneForScore(assessment.compositeScore))}>
              {assessment.compositeScore.toFixed(0)}
            </div>
            <div className="text-xs text-muted-foreground">out of 100</div>
            {assessment.integrityPenalty > 0 && (
              <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                {assessment.rawScore.toFixed(0)} analytics
                <br />
                <span className="text-red-500">−{assessment.integrityPenalty.toFixed(0)} data integrity</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          title="Scorecard"
          description="Weighted pillars behind the composite — expand any pillar for its drivers"
          testId="card-scorecard"
        >
          <Accordion type="multiple" className="w-full">
            {assessment.pillars.map((pillar) => (
              <AccordionItem key={pillar.id} value={pillar.id}>
                <AccordionTrigger className="hover:no-underline" data-testid={`pillar-${pillar.id}`}>
                  <div className="flex w-full items-center justify-between gap-4 pr-3">
                    <div className="flex flex-col items-start gap-0.5 text-left">
                      <span className="text-sm font-medium">{pillar.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {pillar.weight === 0 ? "Excluded from composite" : `${pillar.effectiveWeight.toFixed(0)}% weight`}
                      </span>
                    </div>
                    {pillar.weight === 0 ? (
                      <Badge variant="outline" className="text-xs">
                        n/a
                      </Badge>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="hidden w-24 sm:block">
                          <ScoreBar score={pillar.score} />
                        </div>
                        <span className={cn("w-16 text-right text-sm font-semibold tabular-nums", toneForScore(pillar.score))}>
                          {pillar.score.toFixed(0)}
                        </span>
                      </div>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="mb-3 text-xs text-muted-foreground">{pillar.description}</p>
                  {pillar.unavailableReason ? (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{pillar.unavailableReason}</p>
                  ) : (
                    <div className="space-y-3">
                      {pillar.drivers.map((driver) => (
                        <div key={driver.label} className="rounded-md border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium">{driver.label}</div>
                              <div className="text-xs tabular-nums text-muted-foreground">{driver.value}</div>
                            </div>
                            <div className="text-right">
                              <div className={cn("text-sm font-semibold tabular-nums", toneForScore(driver.score))}>
                                {driver.score.toFixed(0)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">{driver.weight}% of pillar</div>
                            </div>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{driver.commentary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Weights renormalise across the pillars that could be assessed. Data-integrity findings are deducted from the composite
            rather than averaged in, because smoothed or short data undermines the other pillars instead of trading off against them.
          </p>
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="Strengths" description="What supports an allocation" testId="card-strengths">
            <ul className="space-y-2">
              {assessment.strengths.map((s, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Concerns" description="What argues against, or requires an answer" testId="card-concerns">
            <ul className="space-y-2">
              {assessment.concerns.map((c, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Red flags"
        description={
          assessment.redFlags.length === 0
            ? "No findings raised by the quantitative screen"
            : `${assessment.redFlags.length} finding${assessment.redFlags.length === 1 ? "" : "s"}, ordered by severity`
        }
        testId="card-red-flags"
      >
        {assessment.redFlags.length === 0 ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Clean screen</AlertTitle>
            <AlertDescription>
              The return stream raised no red flags. This covers the numbers only — operational, legal and personnel diligence is
              still outstanding.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {assessment.redFlags.map((flag, i) => (
              <div key={i} className="rounded-md border p-4" data-testid={`flag-${i}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={cn("text-xs", SEVERITY_STYLES[flag.severity].badge)}>
                    {SEVERITY_STYLES[flag.severity].label}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {flag.category}
                  </Badge>
                  <span className="text-sm font-medium">{flag.title}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{flag.detail}</p>
                <div className="mt-3 rounded-md bg-muted/40 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Ask the manager</div>
                  <p className="mt-1 text-sm leading-relaxed">{flag.diligenceQuestion}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Data integrity checks" description="Whether the reported numbers can be relied on" testId="card-data-quality">
          <div className="space-y-2">
            {analytics.dataQuality.map((check) => (
              <div key={check.id} className="rounded-md border p-3" data-testid={`check-${check.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{check.label}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">{check.value}</span>
                    <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[check.status].badge)}>
                      {STATUS_STYLES[check.status].label}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{check.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Diligence agenda" description="Questions this return stream cannot answer" testId="card-diligence-agenda">
          <ol className="space-y-3">
            {assessment.diligenceAgenda.map((q, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                  {i + 1}
                </span>
                <span>{q}</span>
              </li>
            ))}
          </ol>
        </SectionCard>
      </div>

      <SectionCard
        title="Investment committee memorandum"
        description="A complete written memo, generated from the analysis above"
        testId="card-memo"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowMemo((v) => !v)} data-testid="button-toggle-memo">
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {showMemo ? "Hide" : "Preview"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyMemo} data-testid="button-copy-memo">
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy
            </Button>
            <Button
              size="sm"
              onClick={() => downloadFile(`${baseName}-ic-memo.md`, assessment.memo, "text/markdown;charset=utf-8")}
              data-testid="button-download-memo"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        }
      >
        {showMemo ? (
          <pre
            className="max-h-[600px] overflow-auto rounded-md border bg-muted/30 p-4 text-xs leading-relaxed"
            data-testid="text-memo"
          >
            {assessment.memo}
          </pre>
        ) : (
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="space-y-1 text-sm">
              <p>
                A ten-section memorandum covering the recommendation, performance summary, scorecard, strengths, red flags, risk
                profile, data integrity, forward simulation, diligence agenda, and the limitations of a returns-only review.
              </p>
              <p className="text-xs text-muted-foreground">
                Markdown format, ready to paste into a board pack. Roughly {Math.round(assessment.memo.length / 1000)}k characters.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      <Separator />

      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">Scope of this assessment.</span> Everything above is derived from the{" "}
        {analytics.meta.periods}-observation return stream supplied, covering {analytics.meta.trackRecordYears.toFixed(1)} years at a{" "}
        {analytics.meta.frequencyLabel.toLowerCase()} frequency, with a risk-free rate of {fmtPercent(analytics.meta.riskFreeRate)}.
        It says nothing about the manager's team, investment process, operational infrastructure, service providers, counterparty
        exposure, legal terms, fee structure, capacity or liquidity — each of which can override a favourable quantitative result.
        Returns are taken as supplied; if they are gross of fees, every figure here is overstated. This is decision support for the
        committee, not a decision.
      </p>
    </div>
  );
}
