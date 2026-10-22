"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import type { AdminNavItem } from "@/domain/admin/access";

// The admin left nav (N5a): only the screens the user's roles allow (no dead links).
export function AdminNav({ items }: { items: readonly AdminNavItem[] }) {
  const path = usePathname();
  // The page title is set here, in the browser, once the server let the staff user in (no page metadata).
  const label = items.find((i) => (i.href === "/admin" ? path === "/admin" : path.startsWith(i.href)))?.label;
  useEffect(() => {
    document.title = `${label ?? "Admin"} · Admin · ParaNaga`;
  }, [label]);
  return (
    <nav aria-label="Admin" className="flex flex-col gap-1" data-testid="admin-nav">
      {items.map((item) => {
        const current = item.href === "/admin" ? path === "/admin" : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            prefetch={false}
            aria-current={current ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium outline-offset-2 focus-visible:outline-2 focus-visible:outline-teal ${
              current ? "bg-navy text-white dark:bg-teal-bright dark:text-on-teal-bright" : "text-navy hover:bg-fill dark:text-white dark:hover:bg-navy-raised"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
