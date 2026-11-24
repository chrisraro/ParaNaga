"use client";

// Step 2 of Report a driver: in-app camera (rear camera preferred), with upload and text-only
// fallbacks. The camera starts only on a tap and is stopped after every capture, on "Close
// camera", and when this component unmounts (leaving the step). Captured files stay in memory.

import { useEffect, useId, useRef, useState } from "react";
import { MAX_CLIP_SECONDS, supportedClipType, useCamera } from "@/client/complaints/use-camera";
import type { CaptureKind } from "@/domain/complaints/schemas";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from "@/domain/media/schemas";
import { useT } from "@/i18n/provider";
import { Live, updateThenFocus } from "@/ui/report/form-a11y";
import type { Evidence } from "./driver-report-wizard";

const MB = 1024 * 1024;

type Props = {
  items: readonly Evidence[];
  max: number;
  accept: string;
  /** Returns a message when the file cannot be added. `replacing`: the item this one takes the place of (Retake). */
  onAdd: (blob: Blob, kind: CaptureKind, replacing?: string) => string | null;
  onRemove: (key: string) => void;
};

export function CameraCapture({ items, max, accept, onAdd, onRemove }: Props) {
  const tt = useT();
  const t = tt.driverReport.camera;
  const uid = useId();
  const { state, recording, start, stop, attach, takePhoto, recordClip, stopClip } = useCamera();
  const [note, setNote] = useState<string | null>(null);
  const [canClip] = useState(() => typeof window !== "undefined" && supportedClipType() !== null);
  // The item a Retake replaces: it stays until the new capture exists (a closed or failed camera keeps it).
  const retaking = useRef<string | null>(null);
  // The capture being finished (the photo is encoded, the clip is recorded). A second tap waits for
  // it; closing the camera or leaving the step forgets it, and what it then produces is dropped.
  const capture = useRef<object | null>(null);
  useEffect(
    () => () => {
      capture.current = null;
    },
    [],
  );
  const full = items.length >= max;
  const live = state === "live";

  // The button that was pressed disappears when the camera opens or closes: move focus to the
  // shutter when it opens, and back to "Add another" (or the captured list) when it closes, so
  // keyboard and screen reader users never land on the page body. Only on those two changes:
  // "starting" turning into "live" leaves focus where the person put it (on "Close camera", say).
  const shutterRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wasActive = useRef(false);
  useEffect(() => {
    const active = live || state === "starting";
    if (active === wasActive.current) return;
    wasActive.current = active;
    (active ? shutterRef.current : (openRef.current ?? listRef.current))?.focus();
  }, [live, state]);

  const add = (blob: Blob | null, kind: CaptureKind, replacing?: string) => {
    if (!blob) return setNote(t.nothingCaptured);
    setNote(onAdd(blob, kind, replacing) ?? t.added);
  };

  const onPhoto = async () => {
    if (!live || recording || capture.current) return;
    const mine = (capture.current = {});
    const replacing = retaking.current ?? undefined;
    const blob = await takePhoto();
    if (capture.current !== mine) return;
    capture.current = null;
    stop();
    retaking.current = null;
    add(blob, "in_app_camera", replacing);
  };
  const onClip = async () => {
    if (!live) return;
    if (recording) return stopClip();
    if (capture.current) return;
    const mine = (capture.current = {});
    const replacing = retaking.current ?? undefined;
    const blob = await recordClip();
    if (capture.current !== mine) return;
    capture.current = null;
    stop();
    retaking.current = null;
    add(blob, "in_app_camera", replacing);
  };
  const retake = (key: string) => {
    retaking.current = key;
    capture.current = null;
    setNote(null);
    void start();
  };
  const closeCamera = () => {
    retaking.current = null;
    capture.current = null;
    stop();
  };

  return (
    <div className="pn-report__form">
      <p className="pn-report__body">
        {t.intro}
      </p>
      {/* Before the buttons: what is allowed, and what an uploaded file carries, is read before choosing. */}
      <p className="pn-report__hint" data-testid="driver-limits">
        {t.limits(max, MAX_CLIP_SECONDS, Math.round(MAX_PHOTO_BYTES / MB), Math.round(MAX_VIDEO_BYTES / MB))}
      </p>

      {items.length > 0 ? (
        <ul ref={listRef} tabIndex={-1} aria-label={t.capturedLabel} className="pn-driver__evidence" data-testid="driver-evidence">
          {items.map((item, n) => (
            <li key={item.key} className="pn-driver__evidence-item">
              {item.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, never optimized
                <img src={item.url} alt={t.photoPreview(n + 1)} className="pn-driver__media" />
              ) : (
                <video src={item.url} controls playsInline muted className="pn-driver__media" aria-label={t.videoPreview(n + 1)} />
              )}
              <div className="pn-report__row">
                {item.captureKind === "in_app_camera" ? (
                  <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => retake(item.key)} aria-label={item.kind === "photo" ? t.retakePhoto(n + 1) : t.retakeVideo(n + 1)}>
                    {t.retake}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pn-btn pn-btn--secondary pn-report__small"
                  onClick={() =>
                    updateThenFocus(
                      () => {
                        onRemove(item.key);
                        setNote(null);
                      },
                      () => (listRef.current?.children[n] ?? listRef.current?.lastElementChild)?.querySelector<HTMLElement>("button:last-of-type") ?? openRef.current ?? shutterRef.current,
                    )
                  }
                  aria-label={item.kind === "photo" ? t.removePhoto(n + 1) : t.removeVideo(n + 1)}
                >
                  {tt.forms.remove}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {live || state === "starting" ? (
        <div className="pn-driver__camera" data-testid="driver-camera">
          <video ref={attach} className="pn-driver__viewfinder" playsInline muted aria-label={t.preview} />
          <div className="pn-report__row">
            <button ref={shutterRef} type="button" className="pn-btn pn-btn--primary pn-report__small" onClick={() => void onPhoto()} aria-disabled={!live || recording || undefined} data-testid="driver-shutter">
              {t.takePhoto}
            </button>
            {canClip ? (
              <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={() => void onClip()} aria-disabled={!live || undefined} data-testid="driver-record">
                {recording ? t.stopRecording : t.recordVideo(MAX_CLIP_SECONDS)}
              </button>
            ) : null}
            <button type="button" className="pn-btn pn-btn--secondary pn-report__small" onClick={closeCamera} data-testid="driver-camera-close">
              {t.closeCamera}
            </button>
          </div>
          <Live className="pn-report__hint">{recording ? t.recording : null}</Live>
        </div>
      ) : null}

      {!live && state !== "starting" && !full ? (
        <div className="pn-report__row">
          <button ref={openRef} type="button" className="pn-btn pn-btn--primary pn-report__small" onClick={() => {
              retaking.current = null;
              capture.current = null;
              void start();
            }} data-testid="driver-open-camera">
            {items.length > 0 ? t.addAnother : t.openCamera}
          </button>
        </div>
      ) : null}

      <Live className="pn-report__hint" data-testid="driver-camera-denied">
        {state === "denied" ? t.denied : null}
      </Live>
      <Live className="pn-report__hint" data-testid="driver-camera-unavailable">
        {state === "unavailable" ? t.unavailable : null}
      </Live>

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
              // The last file takes the picker away.
              if (file) updateThenFocus(() => add(file, "file_upload"), () => listRef.current);
            }}
          />
          <label htmlFor={`${uid}-file`} className="pn-btn pn-btn--secondary pn-report__small pn-driver__upload">
            {t.upload}
          </label>
        </div>
      ) : null}

      <Live className="pn-report__hint" data-testid="driver-capture-note">
        {note}
      </Live>
    </div>
  );
}
