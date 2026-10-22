"use client";

import { useId, useState } from "react";
import { streetViewEmbed, streetViewLink } from "@/domain/media/street-view";
import { useT } from "@/i18n/provider";
import "./street-view.css";

export function StopStreetView({ lat, lng, name, what = "stop" }: { lat: number; lng: number; name: string; what?: "stop" | "place" }) {
  const t = useT().streetView;
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const uid = useId();
  const embed = streetViewEmbed({ lat, lng }, process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY);
  const link = streetViewLink({ lat, lng });
  if (!link) return null;

  const show = () => {
    const disconnected = !navigator.onLine;
    setOffline(disconnected);
    if (!disconnected) setOpen(true);
  };

  return (
    <section className="pn-street-view" aria-labelledby={`${uid}-heading`} data-testid="stop-street-view">
      <h2 id={`${uid}-heading`} className="pn-section__title">{t.title}</h2>
      <p className="pn-footnote">{what === "stop" ? t.stopNote : t.placeNote} {t.imageryNote}</p>
      {embed ? (
        <button className="pn-text-btn" type="button" aria-expanded={open} aria-controls={`${uid}-viewer`} onClick={open ? () => setOpen(false) : show}>
          {open ? t.close : t.view}
        </button>
      ) : <p className="pn-footnote">{t.noViewer}</p>}
      <div id={`${uid}-viewer`}>
        {open && embed ? (
          <iframe
            title={t.frameTitle(name)}
            src={embed}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            data-testid="street-view-iframe"
          />
        ) : null}
      </div>
      {offline ? <p role="status">{t.offline}</p> : null}
      <p className="pn-footnote">{t.loadsNote}</p>
      <a href={link} target="_blank" rel="noopener noreferrer">{t.openExternal}</a>
    </section>
  );
}
