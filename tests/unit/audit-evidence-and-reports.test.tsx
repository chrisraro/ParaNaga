// @vitest-environment jsdom
// Audit F12, F13, F17: a report that needs more detail says what to do, evidence limits are stated
// before capture and checked when a file arrives, Retake keeps the old file until the new one
// exists, and a failed load offers Try again.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorrectionDetail } from "@/domain/reports/schemas";

const auth = vi.hoisted(() => ({
  current: { user: { id: "u1", name: "Ana", roles: [] } as unknown, loading: false, status: "signedIn", refresh: vi.fn(async () => undefined), refreshing: false },
}));
vi.mock("@/client/auth/use-auth-session", () => ({ useAuthSession: () => auth.current }));

const reports = vi.hoisted(() => ({ loadComplaint: vi.fn(), loadCorrection: vi.fn(), loadEvidenceUrl: vi.fn(), saveMyNagaSelfReport: vi.fn() }));
vi.mock("@/client/reports/api", () => reports);

const camera = vi.hoisted(() => ({
  state: "idle" as string,
  start: vi.fn(async () => undefined),
  stop: vi.fn(),
  takePhoto: vi.fn(),
}));
vi.mock("@/client/complaints/use-camera", () => ({
  MAX_CLIP_SECONDS: 30,
  supportedClipType: () => null,
  useCamera: () => ({
    state: camera.state,
    recording: false,
    start: camera.start,
    stop: camera.stop,
    attach: () => undefined,
    takePhoto: camera.takePhoto,
    recordClip: vi.fn(),
    stopClip: vi.fn(),
  }),
}));

const { ReportDetailScreen } = await import("@/ui/reports/report-detail");
const { CameraCapture } = await import("@/ui/report-driver/camera-capture");
const { evidenceFileProblem } = await import("@/ui/report-driver/driver-report-wizard");
const { ReportHandoff } = await import("@/ui/mynaga/report-handoff");
const { en } = await import("@/i18n/en");

const CORRECTION_ID = "33333333-3333-4333-8333-333333333333";
const correction = (status: CorrectionDetail["status"]): CorrectionDetail => ({
  id: CORRECTION_ID,
  category: "wrong_curb_side",
  entityType: "stop",
  entityId: "stop-a1",
  entityLabel: "Plaza Rizal",
  status,
  submittedAt: "2026-10-10T00:00:00.000Z",
  description: "The sign moved.",
  events: [{ status, at: "2026-10-11T00:00:00.000Z", reason: status === "needs_evidence" ? "need_photo" : null }],
});

beforeEach(() => {
  for (const fn of Object.values(reports)) fn.mockReset();
  camera.state = "idle";
  camera.start.mockClear();
  camera.stop.mockClear();
  camera.takePhoto.mockReset();
  auth.current = { ...auth.current, user: { id: "u1", name: "Ana", roles: [] }, status: "signedIn" };
});
afterEach(cleanup);

describe("a report that needs more detail (F12)", () => {
  it("says it cannot be added to here, and links to a new report about the same stop", async () => {
    reports.loadCorrection.mockResolvedValue({ ok: true, data: correction("needs_evidence") });
    render(<ReportDetailScreen kind="correction" id={CORRECTION_ID} />);
    const next = await screen.findByTestId("report-next-step");
    expect(next.textContent).toContain("You cannot add to this report here yet.");
    const link = within(next).getByRole("link", { name: "Send a new report about this" });
    expect(link.getAttribute("href")).toBe("/app/report?type=stop&id=stop-a1&label=Plaza+Rizal");
    // The reviewer's reason is still shown in the timeline.
    expect(screen.getByTestId("report-timeline").textContent).toContain("Please add a photo of what you saw.");
  });

  it("shows no such note for another status", async () => {
    reports.loadCorrection.mockResolvedValue({ ok: true, data: correction("under_review") });
    render(<ReportDetailScreen kind="correction" id={CORRECTION_ID} />);
    await screen.findByTestId("report-timeline");
    expect(screen.queryByTestId("report-next-step")).toBeNull();
  });
});

describe("a failed load offers Try again (F17)", () => {
  it("report detail: the message stays an alert and Try again loads it again", async () => {
    reports.loadCorrection.mockResolvedValueOnce({ ok: false, reason: "failed", message: en.reports.api.failed });
    reports.loadCorrection.mockResolvedValueOnce({ ok: true, data: correction("submitted") });
    render(<ReportDetailScreen kind="correction" id={CORRECTION_ID} />);
    const box = await screen.findByTestId("report-error");
    expect(within(box).getByRole("alert")).toBeTruthy();
    await act(async () => fireEvent.click(within(box).getByRole("button", { name: "Try again" })));
    expect(reports.loadCorrection).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("report-timeline")).toBeTruthy();
    expect(screen.queryByTestId("report-error")).toBeNull();
  });

  it("MyNaga handoff: the same", async () => {
    reports.loadComplaint.mockResolvedValueOnce({ ok: false, reason: "failed", message: en.reports.api.failed });
    reports.loadComplaint.mockImplementationOnce(() => new Promise(() => undefined));
    render(<ReportHandoff id="44444444-4444-4444-8444-444444444444" links={null} />);
    const box = await screen.findByTestId("handoff-error");
    await act(async () => fireEvent.click(within(box).getByRole("button", { name: "Try again" })));
    expect(reports.loadComplaint).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("handoff-error")).toBeNull();
  });
});

describe("evidence files (F13)", () => {
  const t = en.driverReport;
  const file = (name: string, type: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type });

  it("a file over its limit is refused when it arrives, by name, with its own limit", () => {
    expect(evidenceFileProblem(file("street.jpg", "image/jpeg", 10 * 1024 * 1024 + 1), t)).toBe("“street.jpg” is too large. The limit is 10 MB.");
    expect(evidenceFileProblem(file("clip.mp4", "video/mp4", 25 * 1024 * 1024 + 1), t)).toBe("“clip.mp4” is too large. The limit is 25 MB.");
    // A capture has no name: the general message.
    expect(evidenceFileProblem(new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "image/jpeg" }), t)).toBe("This file is too large. The limit is 10 MB.");
  });

  it("accepts a file within its limit, and refuses an empty or unsupported one", () => {
    expect(evidenceFileProblem(file("ok.jpg", "image/jpeg", 1024), t)).toBeNull();
    expect(evidenceFileProblem(file("clip.mp4", "video/mp4", 20 * 1024 * 1024), t)).toBeNull();
    expect(evidenceFileProblem(file("empty.jpg", "image/jpeg", 0), t)).toBe(t.camera.nothingCaptured);
    expect(evidenceFileProblem(file("doc.pdf", "application/pdf", 10), t)).toBe(t.api.badType);
  });

  const item = { key: "k1", blob: new Blob(["x"], { type: "image/jpeg" }), url: "blob:1", kind: "photo" as const, captureKind: "in_app_camera" as const, capturedAt: "2026-11-24T00:00:00.000Z" };
  const props = () => ({ items: [item], max: 3, accept: "image/jpeg", onAdd: vi.fn((): string | null => null), onRemove: vi.fn() });

  it("the limits and the upload metadata notice come before the camera and upload buttons", () => {
    render(<CameraCapture {...props()} />);
    const limits = screen.getByTestId("driver-limits");
    expect(limits.textContent).toContain("Photos up to 10 MB, videos up to 25 MB.");
    expect(limits.textContent).toContain("A file you upload keeps what your phone saved in it, such as where and when it was taken.");
    const open = screen.getByTestId("driver-open-camera");
    expect(limits.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Retake keeps the old file until the new one exists, then hands both keys to the wizard", async () => {
    const p = props();
    camera.takePhoto.mockResolvedValue(new Blob(["y"], { type: "image/jpeg" }));
    const view = render(<CameraCapture {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Retake photo 1" }));
    expect(p.onRemove).not.toHaveBeenCalled();
    expect(camera.start).toHaveBeenCalledTimes(1);

    camera.state = "live";
    view.rerender(<CameraCapture {...p} />);
    await act(async () => fireEvent.click(screen.getByTestId("driver-shutter")));
    expect(p.onAdd).toHaveBeenCalledWith(expect.any(Blob), "in_app_camera", "k1");
    expect(p.onRemove).not.toHaveBeenCalled();
  });

  const pendingPhoto = () => {
    let resolve!: (blob: Blob) => void;
    camera.takePhoto.mockReturnValue(new Promise<Blob>((r) => (resolve = r)));
    return () => act(async () => resolve(new Blob(["y"], { type: "image/jpeg" })));
  };

  it("two taps on the shutter during Retake make one photo", async () => {
    const p = props();
    const finish = pendingPhoto();
    camera.state = "live";
    render(<CameraCapture {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Retake photo 1" }));
    fireEvent.click(screen.getByTestId("driver-shutter"));
    fireEvent.click(screen.getByTestId("driver-shutter"));
    await finish();
    expect(camera.takePhoto).toHaveBeenCalledTimes(1);
    expect(p.onAdd).toHaveBeenCalledTimes(1);
    expect(p.onAdd).toHaveBeenCalledWith(expect.any(Blob), "in_app_camera", "k1");
  });

  it("a photo that finishes after the camera was closed, or the step was left, is dropped", async () => {
    const p = props();
    let finish = pendingPhoto();
    camera.state = "live";
    const view = render(<CameraCapture {...p} />);
    fireEvent.click(screen.getByTestId("driver-shutter"));
    fireEvent.click(screen.getByTestId("driver-camera-close"));
    await finish();
    expect(p.onAdd).not.toHaveBeenCalled();

    finish = pendingPhoto();
    fireEvent.click(screen.getByTestId("driver-shutter"));
    view.unmount();
    await finish();
    expect(p.onAdd).not.toHaveBeenCalled();
  });

  it("closing the camera after Retake keeps the old file, and the next capture is not a replacement", async () => {
    const p = props();
    camera.takePhoto.mockResolvedValue(new Blob(["y"], { type: "image/jpeg" }));
    const view = render(<CameraCapture {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Retake photo 1" }));
    camera.state = "live";
    view.rerender(<CameraCapture {...p} />);
    fireEvent.click(screen.getByTestId("driver-camera-close"));
    expect(p.onRemove).not.toHaveBeenCalled();

    camera.state = "idle";
    view.rerender(<CameraCapture {...p} />);
    fireEvent.click(screen.getByTestId("driver-open-camera"));
    camera.state = "live";
    view.rerender(<CameraCapture {...p} />);
    await act(async () => fireEvent.click(screen.getByTestId("driver-shutter")));
    expect(p.onAdd).toHaveBeenCalledWith(expect.any(Blob), "in_app_camera", undefined);
  });
});
