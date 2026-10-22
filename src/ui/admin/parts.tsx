import type { ReactNode } from "react";

// Small building blocks of the admin screens (N5a). Colours are the design tokens; every pair
// passes WCAG AA in light and dark (tests/e2e/admin.spec.ts runs axe on both).

export const btnPrimary =
  "inline-flex items-center rounded-md bg-teal px-3 py-2 text-sm font-semibold text-white hover:bg-teal-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal dark:bg-teal-bright dark:text-on-teal-bright";
export const btnDanger =
  "inline-flex items-center rounded-md bg-coral-ink px-3 py-2 text-sm font-semibold text-white hover:bg-coral disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral dark:bg-coral-bright dark:text-navy-deep";
export const btnSecondary =
  "inline-flex items-center rounded-md border border-ink-3 px-3 py-2 text-sm font-semibold text-navy hover:bg-fill disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal dark:border-slate-300 dark:text-white dark:hover:bg-navy-raised";

export function PageTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">{children}</h1>
      {lead ? <p className="mt-1 max-w-3xl text-sm text-ink-2 dark:text-slate-300">{lead}</p> : null}
    </header>
  );
}

export function Panel({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-lg border border-fill bg-white p-5 dark:border-navy-raised dark:bg-navy" data-testid={testId} aria-label={title}>
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2 dark:text-slate-300">{children}</p>;
}

export function ErrorNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="alert" className="rounded-md bg-coral-soft px-3 py-2 text-sm text-coral-ink dark:border dark:border-coral-bright dark:bg-navy-deep dark:text-coral-bright" data-testid={testId}>
      {children}
    </p>
  );
}

export function OkNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p role="status" className="rounded-md bg-teal-soft px-3 py-2 text-sm text-teal-ink dark:border dark:border-teal-bright dark:bg-navy-deep dark:text-teal-bright" data-testid={testId}>
      {children}
    </p>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" });

/** Manila time, e.g. "Oct 22, 2026, 10:04 AM"; "–" when unknown. */
export function when(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "–";
}
