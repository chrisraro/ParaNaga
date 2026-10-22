import "./report.css";

import Link from "next/link";
import type { EntityType } from "@/domain/corrections/categories";
import { reportHref } from "@/domain/corrections/href";
import { useT } from "@/i18n/provider";

/** Entry point to the correction wizard from a stop, route, fare or trip screen. */
export function ReportLink({ entityType, entityId, entityLabel }: { entityType: EntityType; entityId: string; entityLabel?: string }) {
  const t = useT().report;
  return (
    <p className="pn-report-link">
      <Link href={reportHref({ entityType, entityId, entityLabel })} prefetch={false} data-testid="report-correction-link">
        {t.link}
      </Link>
    </p>
  );
}
