// One route note: a line of text and its evidence chip. Owner reports are always labelled and never
// read as fact; a note whose reviewed record is not on this phone says "Unverified". Spans only, so it
// may sit inside an option card (a button).
import type { RideNoteView } from "@/domain/trip/option-notes";
import { useT } from "@/i18n/provider";

export function RouteNote({ note }: { note: RideNoteView }) {
  const t = useT().trip;
  const chip = note.evidenceLabel ?? (note.unverified ? t.unverified : null);
  return (
    <span className="pn-route-note" data-testid="route-note">
      <span>{note.text}</span>
      {chip ? (
        <span className={note.unverified ? "pn-evidence-chip pn-evidence-chip--unverified" : "pn-evidence-chip"} data-testid="route-note-evidence">
          {chip}
        </span>
      ) : null}
    </span>
  );
}
