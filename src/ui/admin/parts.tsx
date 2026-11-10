import type { ReactNode } from "react";

// Small building blocks of the admin screens (N5a; finished to the Lunad system in N8). Colours are
// the design tokens; every pair passes WCAG AA in light and dark (tests/e2e/admin.spec.ts runs axe
// on both). The rules these follow are listed at the top of src/app/admin/admin.css; the focus
// ring comes from there too.

// Buttons. Form and page actions are 40px tall; the two that commit something (primary, danger)
// reach 48px with an invisible extension above and below. Row actions inside tables are 32px.
const btnBase = "relative inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const btnMd = "min-h-10 px-3.5 py-2";
const btnSm = "min-h-8 whitespace-nowrap px-2.5 py-1";
const btnHit = "before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']";
const tonePrimary = "bg-brand text-on-brand hover:bg-brand-strong dark:bg-brand-bright dark:text-on-brand-bright dark:hover:bg-brand-light";
const toneDanger = "bg-danger-ink text-white hover:bg-danger dark:bg-danger-bright dark:text-night dark:hover:bg-white";
const toneSecondary = "border border-ink-3 bg-surface text-ink hover:bg-fill dark:border-night-ink-3 dark:bg-transparent dark:text-white dark:hover:bg-night-raised";
const toneDangerQuiet = "border border-danger-ink bg-surface text-danger-ink hover:bg-danger-soft dark:border-danger-bright dark:bg-transparent dark:text-danger-bright dark:hover:bg-night-raised";

export const btnPrimary = `${btnBase} ${btnMd} ${btnHit} ${tonePrimary}`;
/** Destructive, and it acts now (the confirm step, a form's own submit). */
export const btnDanger = `${btnBase} ${btnMd} ${btnHit} ${toneDanger}`;
export const btnSecondary = `${btnBase} ${btnMd} ${toneSecondary}`;
/** Row actions (inside a table or a list row). */
export const btnRow = `${btnBase} ${btnSm} ${toneSecondary}`;
export const btnRowPrimary = `${btnBase} ${btnSm} ${tonePrimary}`;
/** A destructive row action. Outlined: a list never shows a column of solid red. */
export const btnRowDanger = `${btnBase} ${btnSm} ${toneDangerQuiet}`;

/** A two-way filter ("Open" / "Closed"): the group is the track, the pressed button is the thumb. */
export const segGroup = "inline-flex gap-1 rounded-xl border border-border bg-fill p-1 dark:border-night-border dark:bg-night-surface";
export const segBtn =
  "inline-flex min-h-8 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-semibold text-ink-2 hover:text-ink aria-pressed:border-border aria-pressed:bg-surface aria-pressed:text-ink dark:text-night-ink-2 dark:hover:text-white dark:aria-pressed:border-night-border dark:aria-pressed:bg-night-raised dark:aria-pressed:text-white";

/** The one surface of the content area: white, 12px corners, a hairline, no shadow. */
export const cardCls = "rounded-xl border border-border bg-surface dark:border-night-border dark:bg-night-surface";
/** A tinted block inside a surface (an opened row, quoted text). Never a second border. */
export const insetCls = "rounded-lg bg-canvas dark:bg-night";
/** A step that asks for a decision or a code before something changes: the amber wash. */
export const confirmCls = "rounded-xl border border-accent-line bg-accent-soft dark:border-accent/50 dark:bg-accent/10";
/** The same wash without a border, for the last step of a section that is already a surface. */
export const confirmInset = "rounded-lg bg-accent-soft dark:bg-accent/10";
const ruleCls = "border-border dark:border-night-border";
export const linkCls = "font-semibold text-brand-strong underline underline-offset-2 dark:text-brand-bright";

function Icon({ d, className = "mt-0.5" }: { d: string; className?: string }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={d} />
    </svg>
  );
}
const ICON_ALERT = "M12 8v5m0 3.5v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z";
const ICON_CHECK = "m8 12.5 3 3 5-6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z";
const ICON_CONFIRM = "M12 9v4m0 3.5v.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z";

/** Page header: title, one line of purpose, and the screen's primary action on the right. */
export function PageTitle({ children, lead, actions }: { children: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className={`mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b pb-5 ${ruleCls}`}>
      <div className="min-w-0">
        <h1 className="text-balance text-2xl font-bold tracking-tight">{children}</h1>
        {lead ? <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2 dark:text-night-ink-2">{lead}</p> : null}
      </div>
      {actions ? <div className="ml-auto flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/**
 * A titled section. "box" (default) is the one surface; "bare" is only the heading, for lists whose
 * items are already boxed; "rule" is a divider for sections nested inside a boxed one (never a box
 * in a box); "confirm" is the amber step that asks before something is published or rolled back.
 */
export function Panel({ title, children, testId, variant = "box" }: { title: string; children: ReactNode; testId?: string; variant?: "box" | "bare" | "rule" | "confirm" }) {
  const cls = variant === "box" ? `${cardCls} p-5` : variant === "confirm" ? `${confirmCls} p-5` : variant === "rule" ? `border-t pt-4 ${ruleCls}` : "";
  return (
    <section className={cls} data-testid={testId} aria-label={title}>
      <h2 className="mb-3 flex items-start gap-2 text-base font-semibold">
        {variant === "confirm" ? <Icon d={ICON_CONFIRM} className="mt-1 text-accent-ink dark:text-accent" /> : null}
        <span className="min-w-0">{title}</span>
      </h2>
      {children}
    </section>
  );
}

/** What to do next when a list is empty (a quiet block, not an illustration). */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl bg-fill px-5 py-8 text-center dark:bg-night-raised">
      <p className="text-sm font-semibold">{title}</p>
      {children ? <p className="mx-auto mt-1 max-w-md text-sm text-ink-2 dark:text-night-ink-2">{children}</p> : null}
    </div>
  );
}

/** A list or a report on its way: the same quiet block as Empty, so the page does not jump twice. */
export function Loading({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <p role="status" className="rounded-xl bg-fill px-5 py-8 text-center text-sm text-ink-2 dark:bg-night-raised dark:text-night-ink-2">
      {children}
    </p>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2 dark:text-night-ink-2">{children}</p>;
}

const noteCls = "flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm";

export function ErrorNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="alert" className={`${noteCls} bg-danger-soft text-danger-ink dark:bg-danger-bright/14 dark:text-danger-bright`} data-testid={testId}>
      <Icon d={ICON_ALERT} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function OkNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="status" className={`${noteCls} bg-brand-soft text-brand-strong dark:bg-brand-bright/14 dark:text-brand-light`} data-testid={testId}>
      <Icon d={ICON_CHECK} />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Text inputs, selects and textareas of the admin forms (N5b). */
export const inputCls =
  "w-full min-h-10 rounded-lg border border-ink-3 bg-surface px-3 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:opacity-60 dark:border-night-ink-3 dark:bg-night dark:text-white";

/** A labelled form control: the label wraps the control, so it is its accessible name. Label above, hint below. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
      {hint ? <span className="adm-meta text-ink-2 dark:text-night-ink-2">{hint}</span> : null}
    </label>
  );
}

/**
 * A small status chip (text, never colour alone). One meaning per tone across the console:
 * ok (green) = healthy / done, warn (amber) = waiting on a person or a caution, error (red) =
 * failed / blocked, plain (grey fill) = a neutral fact or a closed state (superseded, archived),
 * info (outlined, no fill) = in progress with nothing to do yet (draft, validating).
 */
export type ChipTone = "plain" | "ok" | "warn" | "error" | "info";
const CHIP: Record<ChipTone, string> = {
  plain: "border-transparent bg-fill text-ink-2 dark:bg-night-raised dark:text-night-ink",
  ok: "border-transparent bg-brand-soft text-brand-strong dark:bg-brand-bright/16 dark:text-brand-light",
  warn: "border-transparent bg-accent-soft text-accent-ink dark:bg-accent/14 dark:text-accent",
  error: "border-transparent bg-danger-soft text-danger-ink dark:bg-danger-bright/16 dark:text-danger-bright",
  info: "border-ink-3 bg-surface text-ink-2 dark:border-night-ink-3 dark:bg-transparent dark:text-night-ink-2",
};
export function Chip({ children, tone = "plain" }: { children: ReactNode; tone?: ChipTone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-px text-xs font-semibold ${CHIP[tone]}`}>{children}</span>;
}

const dateFmt = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

/** Manila time, e.g. "Oct 22, 2026, 10:04 AM"; "–" when unknown. */
export function when(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "–";
}
