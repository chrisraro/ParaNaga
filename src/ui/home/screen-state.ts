// Which screen the home map is showing, derived from the trip state it already has (no new state):
// the map alone, a pin being placed, the routes for a planned trip, one option's detail, or running
// guidance. Pure, so the tab bar rule and the Back / Escape order are testable.

export type ScreenState = "home" | "picking" | "directions" | "detail" | "guidance";

export type ScreenFlags = {
  /** A pin is being placed (crosshair). */
  picking: boolean;
  /** Both ends are set: the trip is planned (or planning). */
  ready: boolean;
  /** An option (or a saved trip's option) is open. */
  detail: boolean;
  /** A guidance session is running. */
  guiding: boolean;
};

export function screenState({ picking, ready, detail, guiding }: ScreenFlags): ScreenState {
  if (picking) return "picking";
  if (guiding) return "guidance";
  if (ready && detail) return "detail";
  if (ready) return "directions";
  return "home";
}

/** Only the map shows the tab bar: it steps aside for planning, detail and guidance. */
export function tabBarHidden(state: ScreenState): boolean {
  return state !== "home";
}

export type StepOut = "cancel-pick" | "end-guidance" | "close-detail" | "clear-trip";

/** What Back or Escape does in a state: one step out, in the order guidance, detail, directions, home. */
export function stepOut(state: ScreenState): StepOut | null {
  switch (state) {
    case "picking":
      return "cancel-pick";
    case "guidance":
      return "end-guidance";
    case "detail":
      return "close-detail";
    case "directions":
      return "clear-trip";
    case "home":
      return null;
  }
}

/** Browser-history entries kept above the first: one per state above home (a pin is not one). */
export function historyDepth(flags: ScreenFlags): number {
  const state = screenState({ ...flags, picking: false });
  return state === "guidance" ? 3 : state === "detail" ? 2 : state === "directions" ? 1 : 0;
}
