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
 * A time text with its range spoken in words. Only the formatted range fragment ("8–15 min") is
 * an image with a spoken label ("8 to 15 minutes"), because the en dash is what reads badly; the
 * rest ("Estimate …", "+ waiting (unknown)") stays native, selectable, translatable text, and the
 * text appears once in the DOM.
 */
export function SpokenRange({ text, range, className, testId }: { text: string; range: { lowMin: number | null; highMin: number | null } | null; className?: string; testId?: string }) {
  const shown = range && range.lowMin !== null && range.highMin !== null ? formatRange(range.lowMin, range.highMin) : null;
  const at = shown === null ? -1 : text.indexOf(shown);
  if (range === null || shown === null || at < 0) {
    return <span className={className} data-testid={testId}>{text}</span>;
  }
  return (
    <span className={className} data-testid={testId}>
      {text.slice(0, at)}
      <span role="img" aria-label={formatRangeLabel(range.lowMin!, range.highMin!)}>{shown}</span>
      {text.slice(at + shown.length)}
    </span>
  );
}

/** "Est." for sighted readers; screen readers hear "Estimate" (the accessible name keeps the full word). */
export function EstAbbr() {
  return (
    <abbr title="Estimate" className="pn-est">
      <span aria-hidden="true">Est.</span>
      <span className="sr-only">Estimate</span>
    </abbr>
  );
}

/**
 * The option total ("Estimate 18–27 min + waiting (unknown)"), or "Time not available". `short` is
 * the card form: "Est." as an abbreviation, and "(unknown)" without the ride count.
 */
export function EtaTotalText({ estimate, className, testId, short = false }: { estimate: EtaEstimate | null | undefined; className?: string; testId?: string; short?: boolean }) {
  if (!estimate) return <span className={className} data-testid={testId}>{TIME_NOT_AVAILABLE}</span>;
  const full = formatTotal(estimate.total);
  if (!short || !full.startsWith("Estimate ")) return <SpokenRange text={full} range={estimate.total} className={className} testId={testId} />;
  const rest = full.slice("Estimate ".length).replace(/\(unknown, \d+ rides\)/, "(unknown)");
  return (
    <span className={className} data-testid={testId}>
      <EstAbbr /> <SpokenRange text={rest} range={estimate.total} />
    </span>
  );
}

/** "Peak hours · slower estimate (06:00–08:00)" when the trip uses the peak band (a span: it may sit in a button). */
export function EtaPeakNote({ estimate, className, testId }: { estimate: EtaEstimate | null | undefined; className?: string; testId?: string }) {
  const note = estimate ? formatPeakNote(estimate.total) : null;
  if (!note) return null;
  return <span className={className} data-testid={testId}>{note}</span>;
}
