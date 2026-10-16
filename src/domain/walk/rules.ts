// Time windows of the street-graph road rules (plan E §C, E-J4). A rule's restricted edges are
// usable only inside its lifted window, read on the Asia/Manila clock from an injected `now` (the
// host time zone is never consulted). Pure.
import { clockMinutes, manilaMinutesOfDay } from "../eta/manila-time";

/** One tricycle restriction as the street graph v2 carries it (format.ts `rules`). */
export type StreetRule = {
  code: string;
  label: string;
  sourceCodes: string[];
  /** Manila clock "HH:MM" window [from, to) in which the restriction is lifted (may wrap midnight); null = never lifted. */
  liftedFrom: string | null;
  liftedTo: string | null;
};

/** Labels of the rule codes the builder may emit (the seed carries no label). */
export const STREET_RULE_LABELS: Readonly<Record<string, string>> = {
  "TRI-2006": "Ordinance 2006-005/015 · check for updates",
};

/** True when the rule's restriction is lifted at `now` (Manila time): its edges may be used. */
export function ruleLifted(rule: Pick<StreetRule, "liftedFrom" | "liftedTo">, now: Date): boolean {
  if (rule.liftedFrom === null || rule.liftedTo === null) return false;
  const m = manilaMinutesOfDay(now);
  const from = clockMinutes(rule.liftedFrom);
  const to = clockMinutes(rule.liftedTo);
  return from <= to ? m >= from && m < to : m >= from || m < to;
}
