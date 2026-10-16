// The visible notes for a drawn approximate line (T12-2): the one-way caution wherever a dashed
// one-way-conflict section is drawn, and "terminal access road" where the line uses one.
import "../modes/modes.css";

import { WarnIcon } from "@/ui/detail/detail-frame";
import { ONEWAY_CAUTION, TERMINAL_ACCESS_NOTE, type LineNotes } from "./line-rules";

/** The one-way caution and terminal access note for drawn lines (route card, route detail, trip step). */
export function LineNotesView({ notes, testIdPrefix = "line" }: { notes: LineNotes; testIdPrefix?: string }) {
  if (!notes.onewayCaution && !notes.terminalAccess) return null;
  return (
    <>
      {notes.onewayCaution ? (
        <p className="pn-line-note pn-line-note--caution" data-testid={`${testIdPrefix}-oneway-caution`}>
          <WarnIcon size={14} />
          <span className="pn-line-note__text">{ONEWAY_CAUTION}</span>
        </p>
      ) : null}
      {notes.terminalAccess ? (
        <p className="pn-line-note" data-testid={`${testIdPrefix}-terminal-access`}>
          <span className="pn-line-note__text">{TERMINAL_ACCESS_NOTE}</span>
        </p>
      ) : null}
    </>
  );
}

