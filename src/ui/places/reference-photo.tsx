"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { PlacePhoto } from "@/domain/media/photos";
import { SOURCES_HREF } from "@/ui/help/sources-href";
import { useT } from "@/i18n/provider";
import "./reference-photo.css";

/**
 * A reference photo. On a working screen: the image and a "Photo credit" link only; `full` (the
 * Sources and credits screen) adds the title, creator, licence, capture date and modifications.
 */
export function ReferencePhoto({ photo, stop = false, full = false }: { photo: PlacePhoto; stop?: boolean; full?: boolean }) {
  const t = useT().places;
  const [failed, setFailed] = useState(false);
  return (
    <figure className="pn-reference-photo" data-testid="reference-photo">
      {failed ? <p>{t.photoUnavailable}</p> : (
        <Image src={photo.src} alt={photo.alt} width={960} height={720} sizes="(max-width: 600px) 100vw, 560px" onError={() => setFailed(true)} />
      )}
      <figcaption>
        {full ? (
          <>
            <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">{photo.title}</a>
            {` · ${photo.creator} · `}
            <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer">{photo.license}</a>
            {t.captured(photo.capturedAt, photo.modifications)}
          </>
        ) : (
          <>
            {stop ? t.landmarkPhoto : null}
            <Link href={`${SOURCES_HREF}#${photo.id}`}>{t.photoCredit}</Link>
          </>
        )}
      </figcaption>
    </figure>
  );
}
