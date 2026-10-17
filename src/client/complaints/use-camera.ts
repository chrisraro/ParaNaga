"use client";

// Rear camera for Report a driver (S18 step 2). Permission is asked only when start() runs (a
// tap), never on page load. Every track is stopped on stop(), on unmount, and before a new start,
// so the camera light never stays on after the commuter leaves the step. Audio is never requested.

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "starting" | "live" | "denied" | "unavailable";

export const MAX_CLIP_SECONDS = 30;

const VIDEO_TYPES = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** A recorder type this browser supports, or null when video clips are not possible. */
export function supportedClipType(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function useCamera() {
  const [state, setState] = useState<CameraState>("idle");
  const [recording, setRecording] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const clipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped on stop(): a getUserMedia promise that resolves after stop() is stopped at once.
  const generation = useRef(0);

  const stop = useCallback(() => {
    generation.current += 1;
    clearTimeout(clipTimer.current);
    const rec = recorder.current;
    if (rec) {
      // Leaving mid-clip discards the clip: nothing is kept that the commuter did not review.
      rec.onstop = null;
      rec.ondataavailable = null;
      if (rec.state !== "inactive") rec.stop();
    }
    recorder.current = null;
    stopStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setRecording(false);
    setState((s) => (s === "denied" || s === "unavailable" ? s : "idle"));
  }, []);

  const start = useCallback(async () => {
    stop();
    const mine = generation.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    setState("starting");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (mine !== generation.current) {
        stopStream(s);
        return;
      }
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setState("live");
    } catch (error) {
      if (mine !== generation.current) return;
      const name = error instanceof Error ? error.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }, [stop]);

  // The <video> may mount after the stream is ready.
  const attach = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  const takePhoto = useCallback(async (): Promise<Blob | null> => {
    const el = video.current;
    if (!el || !stream.current || el.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")?.drawImage(el, 0, 0);
    // Re-encoded from pixels: the photo carries no EXIF or location metadata.
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88));
  }, []);

  /** Starts a clip; resolves with it when stopClip() is called or after MAX_CLIP_SECONDS. */
  const recordClip = useCallback((): Promise<Blob | null> => {
    const type = supportedClipType();
    if (!stream.current || !type) return Promise.resolve(null);
    const rec = new MediaRecorder(stream.current, { mimeType: type });
    recorder.current = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    return new Promise((resolve) => {
      rec.onstop = () => {
        clearTimeout(clipTimer.current);
        setRecording(false);
        resolve(chunks.length > 0 ? new Blob(chunks, { type: type.split(";")[0] }) : null);
      };
      rec.start();
      setRecording(true);
      clipTimer.current = setTimeout(() => {
        if (rec.state !== "inactive") rec.stop();
      }, MAX_CLIP_SECONDS * 1000);
    });
  }, []);

  const stopClip = useCallback(() => {
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  useEffect(() => stop, [stop]);

  return { state, recording, start, stop, attach, takePhoto, recordClip, stopClip };
}
