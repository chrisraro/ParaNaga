"use client";

import { useEffect, useState } from "react";
import { fetchCoverage, type AdminResult } from "@/client/admin/api";
import type { Coverage } from "@/domain/admin/schemas";
import { ErrorNote, Muted, PageTitle } from "./parts";

// A13 Coverage audit (N5a, C8, F-E12): what the published revision holds per barangay. The
// spec's 27 × 9 matrix needs field data: today each barangay has a survey status and one
// dimension (exact boarding points verified), so this is the honest subset.
const yesNo = (v: boolean | null) => (v === null ? "Not stated" : v ? "Yes" : "No");
const survey = (s: string) => s.replace(/_/g, " ");

export function CoverageScreen() {
  const [state, setState] = useState<AdminResult<Coverage> | null>(null);
  useEffect(() => {
    let live = true;
    void fetchCoverage().then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div data-testid="admin-coverage">
      <PageTitle lead="Per barangay, from the published revision. The other coverage dimensions (stops, curbs, shapes, fares, hours, walk links, terminals, signs) are added as field data arrives.">
        Coverage audit
      </PageTitle>
      {state === null ? (
        <Muted>Loading…</Muted>
      ) : !state.ok ? (
        <ErrorNote>{state.message}</ErrorNote>
      ) : state.data.rows.length === 0 ? (
        <Muted>The published revision has no barangay rows.</Muted>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-fill bg-white dark:border-navy-raised dark:bg-navy">
          <table className="w-full text-left text-sm" data-testid="coverage-table">
            <caption className="px-3 py-2 text-left text-sm text-ink-2 dark:text-slate-300">
              {state.data.rows.length} barangays in {state.data.label}
            </caption>
            <thead className="border-b border-fill dark:border-navy-raised">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Barangay</th>
                <th scope="col" className="px-3 py-2 font-semibold">Survey status</th>
                <th scope="col" className="px-3 py-2 font-semibold">Exact boarding points verified</th>
              </tr>
            </thead>
            <tbody>
              {state.data.rows.map((r) => (
                <tr key={r.barangay} className="border-b border-fill last:border-0 dark:border-navy-raised">
                  <th scope="row" className="px-3 py-2 font-medium">{r.barangay}</th>
                  <td className="px-3 py-2">{survey(r.surveyStatus)}</td>
                  <td className="px-3 py-2">{yesNo(r.exactBoardingPointsVerified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
