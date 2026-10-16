"use client";

// Reactive trip time estimates (Task 14, D8–D12).
// Computes on-device ranges using the revision's EtaModel and the current Manila time.
// Ticks once per minute so peak-window transitions reflect in real-time.

import { useEffect, useMemo, useState } from "react";
import type { EtaModel } from "@/domain/api/schemas";
import {
  estimateOption,
  type EtaEstimate,
  type EtaOptionInput,
  type EtaResult,
  type EtaUnavailableReason,
} from "@/domain/eta/eta";
import { TIME_NOT_AVAILABLE, formatPeakNote, formatRange, formatRangeLabel, formatTotal } from "@/domain/eta/format";
import type { EnrichedLeg } from "@/domain/trip/enrich";

/**
 * Ticks roughly at the start of every minute to re-evaluate peak windows.
 */
export function useMinuteTicker(enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return undefined;
    // Align with the start of the next minute
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => {
        setNow(new Date());
      }, 60_000);
    }, msToNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [enabled]);

  return now;
}

/**
 * Extracts street-graph walk path lengths in metres from enriched legs.
 */
export function extractWalkLengths(legs: ReadonlyArray<EnrichedLeg | unknown>): (number | null)[] {
  return legs.map((leg) => {
    if (typeof leg === "object" && leg !== null && "kind" in leg && leg.kind === "walk") {
      const walkLeg = leg as { path?: { kind: string; lengthM: number } };
      if (walkLeg.path?.kind === "path" && typeof walkLeg.path.lengthM === "number") {
        return walkLeg.path.lengthM;
      }
    }
    return null;
  });
}

/**
 * Reactive hook computing an option's time estimate.
 */
export function useOptionEta(
  option: EtaOptionInput | null | undefined,
  walkLengths: ReadonlyArray<number | null | undefined>,
  model: EtaModel | null | undefined,
  departureOverride?: Date,
): { estimate: EtaEstimate | null; reason: EtaUnavailableReason | null } {
  const now = useMinuteTicker(!departureOverride && !!option && !!model);
  const departure = departureOverride ?? now;

  return useMemo(() => {
    if (!option || !model) return { estimate: null, reason: "no_model" };
    const res: EtaResult = estimateOption(option, walkLengths, model, departure);
    if (res.ok) return { estimate: res.estimate, reason: null };
    return { estimate: null, reason: res.reason };
  }, [option, walkLengths, model, departure]);
}


/**
 * A time text with its range spoken in words. The visible copy ("Estimate 8–15 min …") appears
 * once in the DOM; role="img" plus an aria-label carries "Estimate 8 to 15 minutes …" (formatRangeLabel)
 * as the accessible name, and a button or card containing it takes that name from the label.
 */
export function SpokenRange({ text, range, className, testId }: { text: string; range: { lowMin: number | null; highMin: number | null } | null; className?: string; testId?: string }) {
  if (!range || range.lowMin === null || range.highMin === null) {
    return <span className={className} data-testid={testId}>{text}</span>;
  }
  const spoken = text.replace(formatRange(range.lowMin, range.highMin), formatRangeLabel(range.lowMin, range.highMin));
  return (
    <span className={className} data-testid={testId} role="img" aria-label={spoken}>
      {text}
    </span>
  );
}

/** The option total ("Estimate 18–27 min + waiting (unknown)"), or "Time not available". */
export function EtaTotalText({ estimate, className, testId }: { estimate: EtaEstimate | null | undefined; className?: string; testId?: string }) {
  if (!estimate) return <span className={className} data-testid={testId}>{TIME_NOT_AVAILABLE}</span>;
  return <SpokenRange text={formatTotal(estimate.total)} range={estimate.total} className={className} testId={testId} />;
}

/** "Peak hours · slower estimate (06:00–08:00)" when the trip uses the peak band (a span: it may sit in a button). */
export function EtaPeakNote({ estimate, className, testId }: { estimate: EtaEstimate | null | undefined; className?: string; testId?: string }) {
  const note = estimate ? formatPeakNote(estimate.total) : null;
  if (!note) return null;
  return <span className={className} data-testid={testId}>{note}</span>;
}
