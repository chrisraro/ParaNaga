"use client";

// Vehicle-class chips for a route's fleet (Task 11): one ModeChip per class record with its
// evidence text (e.g. "Modern jeepney · air-conditioned · operating (owner-confirmed October 2026)"),
// or a single unconfirmed chip when the route has no class records.

import "./modes.css";

import type { FleetSummary, RouteMode } from "@/domain/modes/modes";
import { ModeChip } from "./mode-chip";

export type FleetChipsProps = {
  fleet: FleetSummary;
  mode?: RouteMode;
  className?: string;
};

export function FleetChips({ fleet, className }: FleetChipsProps) {
  if (fleet.classes.length === 0) {
    return (
      <div className={["pn-fleet-chips", className ?? ""].filter(Boolean).join(" ")} data-testid="fleet-chips">
        <ModeChip mode="unconfirmed" label={fleet.label} />
      </div>
    );
  }

  return (
    <ul className={["pn-fleet-chips", className ?? ""].filter(Boolean).join(" ")} data-testid="fleet-chips">
      {fleet.classes.map((cls) => (
        <li key={cls.code}>
          <ModeChip mode={cls.vehicleClass} label={cls.label} />
        </li>
      ))}
    </ul>
  );
}
