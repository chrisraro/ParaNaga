"use client";

import { useEffect, useState } from "react";
import { fetchCoverage, type AdminResult } from "@/client/admin/api";
import type { Coverage } from "@/domain/admin/schemas";
import { cardCls, Empty, ErrorNote, Loading, PageTitle } from "./parts";

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
        <Loading />
      ) : !state.ok ? (
        <ErrorNote>{state.message}</ErrorNote>
      ) : state.data.rows.length === 0 ? (
        <Empty title="The published revision has no barangay rows.">Rows appear once a revision with barangay survey data is published.</Empty>
      ) : (
        <div tabIndex={0} className={`adm-scroll ${cardCls}`}>
          <table className="w-full text-left text-sm" data-testid="coverage-table">
            <caption className="text-left text-ink-2 dark:text-night-ink-2">
              {state.data.rows.length} barangays in {state.data.label}
            </caption>
            <thead>
              <tr>
                <th scope="col">Barangay</th>
                <th scope="col">Survey status</th>
                <th scope="col">Exact boarding points verified</th>
              </tr>
            </thead>
            <tbody>
              {state.data.rows.map((r) => (
                <tr key={r.barangay}>
                  <th scope="row" className="font-medium">{r.barangay}</th>
                  <td>{survey(r.surveyStatus)}</td>
                  <td>{yesNo(r.exactBoardingPointsVerified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
