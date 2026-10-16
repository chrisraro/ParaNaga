"use client";

import { useId, useState } from "react";
import { streetViewEmbed, streetViewLink } from "@/domain/media/street-view";
import "./street-view.css";

export function StopStreetView({ lat, lng, name, what = "stop" }: { lat: number; lng: number; name: string; what?: "stop" | "place" }) {
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
      <h2 id={`${uid}-heading`} className="pn-section__title">See the surroundings</h2>
      <p className="pn-footnote">{what === "stop" ? "Street View near this stop—signage and boarding location unverified." : "Street View near this place—entrance and signage unverified."} Imagery may be older or taken from a nearby road.</p>
      {embed ? (
        <button className="pn-text-btn" type="button" aria-expanded={open} aria-controls={`${uid}-viewer`} onClick={open ? () => setOpen(false) : show}>
          {open ? "Close Street View" : "View surroundings"}
        </button>
      ) : <p className="pn-footnote">The in-app viewer is not available in this version of the app. Street View opens in Google Maps instead.</p>}
      <div id={`${uid}-viewer`}>
        {open && embed ? (
          <iframe
            title={`Google Street View near ${name}`}
            src={embed}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            data-testid="street-view-iframe"
          />
        ) : null}
      </div>
      {offline ? <p role="status">Internet is required for Street View. Reconnect and try again.</p> : null}
      <p className="pn-footnote">Loads Google Maps only when opened. Internet required. If coverage is unavailable or the viewer is blocked, use the external link.</p>
      <a href={link} target="_blank" rel="noopener noreferrer">Open Street View in Google Maps</a>
    </section>
  );
}

