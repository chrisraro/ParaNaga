// The soft jeepney service-window warning. It never hides an option and never promises a trip:
// "unconfirmed" in every state. `compact` is the one-line form on an option card (spans only, it
// sits inside a button); the full form belongs in the option detail.
import type { ServiceWindowNote as Note } from "@/domain/eta/service-window";
import { serviceWindowCardLine } from "@/domain/trip/option-card";
import { useT } from "@/i18n/provider";

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ServiceWindowNote({ note, compact = false }: { note: Note; compact?: boolean }) {
  const e = useT().eta;
  if (compact) {
    return (
      <span className="pn-svc-note pn-svc-note--compact" data-testid="service-window-note" data-state={note.state}>
        <ClockIcon />
        <span>{serviceWindowCardLine(note, e)}</span>
      </span>
    );
  }
  return (
    <div className="pn-svc-note" data-testid="service-window-note" data-state={note.state}>
      <ClockIcon />
      <div>
        {note.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p className="pn-svc-note__hint">{note.hint}</p>
      </div>
    </div>
  );
}
