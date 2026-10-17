# Far areas T5 report (via groups)
Code: src/domain/planner/plan.ts (activeVias; planTrip option `viaGroups` defaults to FAR_AREAS.viaGroups; `via?: PlanVia` on PlanOption), src/domain/api/plan.ts (planOptionSchema `via` optional). No route code in the planner: driven by viaGroups data.
Rule: a group is active when 2+ of its routes have a one-ride candidate in the `best` map (after must-save-walking). Block = Pareto picks + best candidate per via route; every one-ride option on a via route of an active group carries via {group, routeCode, label, note}. Budget = 6 - walk - access - tricycle - padyak (min 1). Trim: non-via extras first (worst score first), then vias (worst first); the best-score option is never trimmed; a label on a dropped option is dropped. Without active vias the old flow is untouched (slice at 6).
Plaza Rizal -> Del Rosario node: R2 Magsaysay (note "Locals may call it Francia (unconfirmed)"), R3 Roxas (Diversion), R4 Panganiban, tricycle Recommended, 4 options (before: R2, R3 only).

## Regression digest (200 trips) rebaselined
Before 538 options {jeepney 320, tricycle 200, padyak 8, walk 10}, digest 2ae78fae...; after 577 {jeepney 359, tricycle 200, padyak 8, walk 10}, digest 6d8045ec...
Trips changed: 23 of 200, +39 options (8 trips +1, 14 trips +2, 1 trip +3). Changed trips == trips with a via chip (mismatch 0): the other 177 are byte-identical to the viaGroups=[] plan. Only jeepney options added; no tricycle/walk/padyak change.
Examples: Centro short hop `R1[Fewest] | R4>R1[Least walking] | tricycle[Rec]` -> `R1[Fewest] | VR2 | VR4 | R4>R1[Least walking] | tricycle[Rec]`; `R4[Fewest/Least] | tricycle[Rec] | padyak` -> `VR4[Fewest/Least] | VR3 | tricycle[Rec] | padyak`.
Note: the 23 are Centro trips (near Loop A/B pins) reached by 2+ of R2/R3/R4, not only Del Rosario destinations; the rule is geography-free by design.
