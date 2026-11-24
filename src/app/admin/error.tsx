"use client";

import { btnPrimary, ErrorNote, PageTitle } from "@/ui/admin/parts";

// A screen of the console that failed to render (A10). The thrown value is never shown or logged
// here: it may carry what the screen was holding (a report, an address). `retry` asks the server
// for the screen again; the rail and the sign-in check of the layout stay as they are.
export default function AdminError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div data-testid="admin-error">
      <PageTitle lead="Try again. If it keeps happening, reload the page; a change you just saved shows in the audit log.">This screen could not be shown</PageTitle>
      <div className="grid justify-items-start gap-3">
        <ErrorNote>Something went wrong while showing this screen.</ErrorNote>
        <button type="button" className={btnPrimary} onClick={() => retry()} data-testid="admin-error-retry">
          Retry
        </button>
      </div>
    </div>
  );
}
