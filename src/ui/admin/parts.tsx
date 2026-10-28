import type { ReactNode } from "react";

// Small building blocks of the admin screens (N5a). Colours are the design tokens; every pair
// passes WCAG AA in light and dark (tests/e2e/admin.spec.ts runs axe on both).

const btnBase =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";
export const btnPrimary = `${btnBase} bg-teal text-white hover:bg-teal-ink focus-visible:outline-teal dark:bg-teal-bright dark:text-on-teal-bright dark:hover:bg-white`;
export const btnDanger = `${btnBase} bg-coral-ink text-white hover:bg-coral focus-visible:outline-coral dark:bg-coral-bright dark:text-navy-deep dark:hover:bg-white`;
export const btnSecondary = `${btnBase} border border-ink-3 bg-white text-navy hover:bg-fill focus-visible:outline-teal dark:border-slate-300 dark:bg-transparent dark:text-white dark:hover:bg-navy-raised`;

/** Page header: title, one line of purpose, and the screen's primary action on the right. */
export function PageTitle({ children, lead, actions }: { children: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="adm-in mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-ink-3/25 pb-5 dark:border-navy-raised">
      <div className="min-w-0">
        <h1 className="text-balance text-3xl font-semibold tracking-tight">{children}</h1>
        {lead ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2 dark:text-slate-300">{lead}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled section. "box" (default) is the one surface; "bare" is only the heading, for lists whose
 * items are already boxed; "rule" is a divider for sections nested inside a boxed one (never a box in a box).
 */
export function Panel({ title, children, testId, variant = "box" }: { title: string; children: ReactNode; testId?: string; variant?: "box" | "bare" | "rule" }) {
  const cls =
    variant === "box"
      ? "rounded-xl border border-ink-3/25 bg-white p-5 dark:border-navy-raised dark:bg-navy"
      : variant === "rule"
        ? "border-t border-ink-3/25 pt-4 dark:border-navy-raised"
        : "";
  return (
    <section className={`adm-in ${cls}`} data-testid={testId} aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold text-ink-2 dark:text-slate-300">{title}</h2>
      {children}
    </section>
  );
}

/** What to do next when a list is empty (a quiet block, not an illustration). */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-3/50 px-5 py-8 text-center dark:border-slate-300/40">
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-2 dark:text-slate-300">{children}</p> : null}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2 dark:text-slate-300">{children}</p>;
}

export function ErrorNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="alert" className="rounded-lg bg-coral-soft px-3 py-2.5 text-sm text-coral-ink dark:border dark:border-coral-bright dark:bg-navy-deep dark:text-coral-bright" data-testid={testId}>
      {children}
    </p>
  );
}

export function OkNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="status" className="rounded-lg bg-teal-soft px-3 py-2.5 text-sm text-teal-ink dark:border dark:border-teal-bright dark:bg-navy-deep dark:text-teal-bright" data-testid={testId}>
      {children}
    </p>
  );
}

/** Text inputs, selects and textareas of the admin forms (N5b). */
export const inputCls =
  "w-full min-h-9 rounded-md border border-ink-3 bg-white px-2.5 py-1.5 text-sm text-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-300 dark:bg-navy-deep dark:text-white";

/** A labelled form control: the label wraps the control, so it is its accessible name. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-2 dark:text-slate-300">{hint}</span> : null}
    </label>
  );
}

/**
 * A small status chip (text, never colour alone). One meaning per tone across the console:
 * ok = healthy / done, warn = needs a person's attention, error = failed / blocked,
 * info = in progress (draft, validating), plain = neutral (superseded, archived).
 */
export type ChipTone = "plain" | "ok" | "warn" | "error" | "info";
const CHIP: Record<ChipTone, string> = {
  plain: "bg-fill text-navy dark:bg-navy-raised dark:text-white",
  ok: "bg-teal-soft text-teal-ink dark:border dark:border-teal-bright dark:bg-navy-deep dark:text-teal-bright",
  warn: "bg-[#fdf0cf] text-gold-ink dark:border dark:border-gold dark:bg-navy-deep dark:text-gold",
  error: "bg-coral-soft text-coral-ink dark:border dark:border-coral-bright dark:bg-navy-deep dark:text-coral-bright",
  info: "bg-[#e3e9f7] text-navy dark:border dark:border-slate-300 dark:bg-navy-deep dark:text-slate-200",
};
export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: ChipTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CHIP[tone]}`}>{children}</span>;
}

const dateFmt = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

/** Manila time, e.g. "Oct 22, 2026, 10:04 AM"; "–" when unknown. */
export function when(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "–";
}
