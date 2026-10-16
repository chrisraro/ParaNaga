"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { PlacePhoto } from "@/domain/media/photos";
import "./reference-photo.css";

export function ReferencePhoto({ photo, stop = false }: { photo: PlacePhoto; stop?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="pn-reference-photo" data-testid="reference-photo">
      {failed ? <p>Photo unavailable on this device.</p> : (
        <Image src={photo.src} alt={photo.alt} width={960} height={720} sizes="(max-width: 600px) 100vw, 560px" onError={() => setFailed(true)} />
      )}
      <figcaption>
        {stop ? <strong>Nearby landmark reference · stop sign and boarding curb unverified. </strong> : null}
        <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">{photo.title}</a>
        {` · ${photo.creator} · `}
        <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>
        {` · Captured: ${photo.capturedAt}. ${photo.modifications} `}
        <Link href={`/app/help/sources#${photo.id}`}>Photo credits</Link>
      </figcaption>
    </figure>
  );
}
