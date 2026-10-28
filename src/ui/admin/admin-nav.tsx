"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AdminNavItem } from "@/domain/admin/access";

// The admin left nav (N5a, redesigned N8): only the screens the user's roles allow (no dead
// links), grouped by job. Under 1024px it is a drawer behind a menu button.
const GROUPS: readonly { title: string | null; hrefs: readonly string[] }[] = [
  { title: null, hrefs: ["/admin"] },
  {
    title: "Network data",
    hrefs: ["/admin/revisions", "/admin/imports", "/admin/candidates", "/admin/corrections", "/admin/coverage", "/admin/stops", "/admin/reconciliation"],
  },
  { title: "Community", hrefs: ["/admin/moderation", "/admin/complaints"] },
  { title: "System", hrefs: ["/admin/jobs", "/admin/providers", "/admin/users", "/admin/audit"] },
];

export function AdminNav({ items, children }: { items: readonly AdminNavItem[]; children?: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const isCurrent = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  // The page title is set here, in the browser, once the server let the staff user in (no page metadata).
  const label = items.find((i) => isCurrent(i.href))?.label;
  useEffect(() => {
    document.title = `${label ?? "Admin"} · Admin · ParaNaga`;
  }, [label]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Routes missing from GROUPS still show (under System), so a new screen is never hidden.
  const known = new Set(GROUPS.flatMap((g) => g.hrefs));
  const groups = GROUPS.map((g, i) => ({
    title: g.title,
    items: [...g.hrefs.flatMap((h) => items.filter((i2) => i2.href === h)), ...(i === GROUPS.length - 1 ? items.filter((i2) => !known.has(i2.href)) : [])],
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-navy px-4 text-white lg:hidden">
        <button
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls="admin-rail"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold outline-offset-2 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-teal-bright"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M2 4.5h14M2 9h14M2 13.5h14" />
          </svg>
          Menu
        </button>
        <span className="text-sm text-slate-300">{label ?? "Admin"}</span>
      </div>
      {open ? <button type="button" tabIndex={-1} aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-black/50 lg:hidden" /> : null}
      <aside
        id="admin-rail"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col gap-5 overflow-y-auto bg-navy p-4 text-white transition-[translate,visibility] duration-200 ease-out motion-reduce:transition-none lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:shrink-0 lg:translate-x-0 lg:visible dark:bg-[#0a1430] dark:border-r dark:border-navy-raised ${
          open ? "translate-x-0 visible" : "-translate-x-full invisible"
        }`}
      >
        <p className="px-3 pt-1 text-lg font-semibold tracking-tight">
          ParaNaga <span className="font-normal text-slate-300">admin</span>
        </p>
        <nav aria-label="Admin" className="flex flex-col gap-4" data-testid="admin-nav">
          {groups.map((g) => (
            <div key={g.title ?? "top"} role="group" aria-label={g.title ?? undefined} className="flex flex-col gap-0.5">
              {g.title ? <p className="px-3 pb-1 text-xs font-medium text-slate-300">{g.title}</p> : null}
              {g.items.map((item) => {
                const current = isCurrent(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    aria-current={current ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`rounded-md px-3 py-2 text-sm outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-teal-bright ${
                      current ? "bg-white font-semibold text-navy" : "font-medium text-slate-200 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="mt-auto">{children}</div>
      </aside>
    </>
  );
}
