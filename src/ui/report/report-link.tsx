import "./report.css";

import Link from "next/link";
import type { EntityType } from "@/domain/corrections/categories";
import { reportHref } from "@/domain/corrections/href";

/** Entry point to the correction wizard from a stop, route, fare or trip screen. */
export function ReportLink({ entityType, entityId, entityLabel }: { entityType: EntityType; entityId: string; entityLabel?: string }) {
  return (
    <p className="pn-report-link">
      <Link href={reportHref({ entityType, entityId, entityLabel })} data-testid="report-correction-link">
        Report a correction
      </Link>
    </p>
  );
}
