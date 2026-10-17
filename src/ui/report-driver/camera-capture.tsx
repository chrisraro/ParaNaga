"use client";

// Step 2 of Report a driver: in-app camera (rear camera preferred), with upload and text-only
// fallbacks. The camera starts only on a tap and is stopped after every capture, on "Close
// camera", and when this component unmounts (leaving the step). Captured files stay in memory.

import { useEffect, useId, useRef, useState } from "react";
import { MAX_CLIP_SECONDS, supportedClipType, useCamera } from "@/client/complaints/use-camera";
import type { CaptureKind } from "@/domain/complaints/schemas";
import type { Evidence } from "./driver-report-wizard";

type Props = {
  items: readonly Evidence[];
  max: number;
  accept: string;
  /** Returns a message when the file cannot be added. */
  onAdd: (blob: Blob, kind: CaptureKind) => string | null;
  onRemove: (key: string) => void;
};

export function CameraCapture({ items, max, accept, onAdd, onRemove }: Props) {
  const uid = useId();
  const { state, recording, start, stop, attach, takePhoto, recordClip, stopClip } = useCamera();
  const [note, setNote] = useState<string | null>(null);
  const [canClip] = useState(() => typeof window !== "undefined" && supportedClipType() !== null);
  const full = items.length >= max;
  const live = state === "live";

  // The button that was pressed disappears when the camera opens or closes: move focus to the
  // shutter when it is live, and back to "Add another" (or the captured list) when it closes, so
  // keyboard and screen reader users never land on the page body.
  const shutterRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasActive = useRef(false);
  useEffect(() => {
    if (live) {
      wasActive.current = true;
      shutterRef.current?.focus();
    } else if (state === "starting") {
      wasActive.current = true;
    } else if (wasActive.current) {
      wasActive.current = false;
      (openRef.current ?? listRef.current)?.focus();
    }
  }, [live, state, items.length]);

  const add = (blob: Blob | null, kind: CaptureKind) => {
    if (!blob) return setNote("Nothing was captured. Try again.");
    setNote(onAdd(blob, kind));
  };

  const onPhoto = async () => {
    const blob = await takePhoto();
    stop();
    add(blob, "in_app_camera");
  };
  const onClip = async () => {
    if (recording) return stopClip();
    const blob = await recordClip();
    stop();
    add(blob, "in_app_camera");
  };
  const retake = (key: string) => {
    onRemove(key);
    setNote(null);
    void start();
  };

  return (
    <div className="pn-report__form">
      <p className="pn-report__body">
        A photo or short video can help, but it is optional. Your phone asks for camera permission only when you tap Open camera.
      </p>

      {items.length > 0 ? (
        <ul ref={listRef} tabIndex={-1} aria-label="Captured photos and videos" className="pn-driver__evidence" data-testid="driver-evidence">
          {items.map((item, n) => (
            <li key={item.key} className="pn-driver__evidence-item">
              {item.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, never optimized
                <img src={item.url} alt={`Photo ${n + 1} preview`} className="pn-driver__media" />
              ) : (
                <video src={item.url} controls playsInline muted className="pn-driver__media" aria-label={`Video ${n + 1} preview`} />
              )}
              <div className="pn-report__row">
                {item.captureKind === "in_app_camera" ? (
                  <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => retake(item.key)}>
                    Retake
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pn-btn pn-btn--secondary pn-report__small"
                  onClick={() => onRemove(item.key)}
                  aria-label={`Remove ${item.kind} ${n + 1}`}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {live || state === "starting" ? (
        <div className="pn-driver__camera" data-testid="driver-camera">
          <video ref={attach} className="pn-driver__viewfinder" playsInline muted aria-label="Camera preview" />
          <div className="pn-report__row">
            <button ref={shutterRef} type="button" className="pn-btn pn-btn--primary pn-report__small" onClick={() => void onPhoto()} disabled={!live || recording} data-testid="driver-shutter">
              Take photo
            </button>
            {canClip ? (
              <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => void onClip()} disabled={!live} data-testid="driver-record">
                {recording ? "Stop recording" : `Record video (up to ${MAX_CLIP_SECONDS} s)`}
              </button>
            ) : null}
            <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={stop} data-testid="driver-camera-close">
              Close camera
            </button>
          </div>
          {recording ? (
            <p className="pn-report__hint" role="status">
              Recording. Tap Stop recording when done.
            </p>
          ) : null}
        </div>
      ) : null}

      {!live && state !== "starting" && !full ? (
        <div className="pn-report__row">
          <button ref={openRef} type="button" className="pn-btn pn-btn--primary pn-report__small" onClick={() => void start()} data-testid="driver-open-camera">
            {items.length > 0 ? "Add another" : "Open camera"}
          </button>
        </div>
      ) : null}

      {state === "denied" ? (
        <p className="pn-report__hint" role="status" data-testid="driver-camera-denied">
          Camera access is off for ParaNaga. You can upload a photo or video instead, or continue without one. To use the camera, allow it in your browser settings.
        </p>
      ) : null}
      {state === "unavailable" ? (
        <p className="pn-report__hint" role="status" data-testid="driver-camera-unavailable">
          The camera could not be opened on this phone. You can upload a photo or video instead, or continue without one.
        </p>
      ) : null}

      {!full ? (
        <div className="pn-report__field">
          <input
            id={`${uid}-file`}
            type="file"
            accept={accept}
            className="pn-report__file"
            data-testid="driver-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) add(file, "file_upload");
            }}
          />
          <label htmlFor={`${uid}-file`} className="pn-btn pn-btn--secondary pn-report__small pn-driver__upload">
            Upload a photo or video instead
          </label>
        </div>
      ) : null}

      <p className="pn-report__hint">
        Up to {max} photos or videos. Videos up to {MAX_CLIP_SECONDS} seconds. Photos taken here carry no location data. Files are kept in private storage.
      </p>
      {note ? (
        <p className="pn-report__hint" role="status" data-testid="driver-capture-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}
