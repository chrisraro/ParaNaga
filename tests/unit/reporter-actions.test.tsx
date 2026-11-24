// @vitest-environment jsdom
// Reporter actions on My reports (migration 0038): the client calls (status to reason), the answer
// form (validation, uploads kept across a retry, text kept on any failure, one send at a time), the
// withdraw dialog, the timeline label for the person's own answers, and leaving the page.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplaintDetail, CorrectionDetail } from "@/domain/reports/schemas";

const auth = vi.hoisted(() => ({ current: { user: { id: "u1", name: "Ana", roles: [] } as unknown, loading: false, status: "signedIn", refresh: vi.fn(async () => undefined), refreshing: false } }));
vi.mock("@/client/auth/use-auth-session", () => ({ useAuthSession: () => auth.current }));

const api = vi.hoisted(() => ({
  loadComplaint: vi.fn(),
  loadCorrection: vi.fn(),
  loadEvidenceUrl: vi.fn(),
  saveMyNagaSelfReport: vi.fn(),
  answerComplaint: vi.fn(),
  answerCorrection: vi.fn(),
  withdrawComplaint: vi.fn(),
}));
vi.mock("@/client/reports/api", () => api);

const uploads = vi.hoisted(() => ({ complaint: vi.fn(), photo: vi.fn() }));
vi.mock("@/client/complaints/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/client/complaints/api")>()), uploadComplaintEvidence: uploads.complaint }));
vi.mock("@/client/corrections/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/client/corrections/api")>()), uploadEvidencePhoto: uploads.photo }));

const { ReportDetailScreen } = await import("@/ui/reports/report-detail");
const { en } = await import("@/i18n/en");
const clientApi = await vi.importActual<typeof import("@/client/reports/api")>("@/client/reports/api");

const ID = "33333333-3333-4333-8333-333333333333";
const MEDIA = "44444444-4444-4444-8444-444444444444";
const MEDIA2 = "55555555-5555-4555-8555-555555555555";

const complaint = (status: ComplaintDetail["status"], extra: Partial<ComplaintDetail> = {}): ComplaintDetail => ({
  id: ID,
  reference: "PN-7KQ4-2M",
  category: "overcharging",
  status,
  submittedAt: "2026-10-17T16:00:00.000Z",
  incidentAt: "2026-10-17T14:30:00.000Z",
  description: "Asked for 40 pesos.",
  locationText: null,
  operator: null,
  plate: null,
  bodyNumber: null,
  outcomeCode: null,
  evidence: [],
  events: [{ status, at: "2026-10-18T01:00:00.000Z", note: null, own: false }],
  handoff: { submitted: false, submittedAt: null, reference: null },
  ...extra,
});
const correction = (status: CorrectionDetail["status"], extra: Partial<CorrectionDetail> = {}): CorrectionDetail => ({
  id: ID,
  category: "wrong_curb_side",
  entityType: "stop",
  entityId: "stop-a1",
  entityLabel: "Plaza Rizal",
  status,
  submittedAt: "2026-10-10T00:00:00.000Z",
  description: "The sign moved.",
  events: [{ status, at: "2026-10-11T00:00:00.000Z", reason: null, answer: null }],
  photoCount: 0,
  ...extra,
});
const ok = { ok: true, data: true };
const photo = (name = "wall.jpg", type = "image/jpeg") => new File([new Uint8Array(10)], name, { type });

beforeEach(() => {
  for (const fn of [...Object.values(api), ...Object.values(uploads)]) fn.mockReset();
  auth.current = { ...auth.current, user: { id: "u1", name: "Ana", roles: [] }, status: "signedIn" };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

describe("client calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown = { ok: true }) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it("posts the withdraw with an empty body to the right path", async () => {
    reply(200);
    expect(await clientApi.withdrawComplaint(ID)).toEqual({ ok: true, data: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/v1/me/reports/complaint/${ID}/withdraw`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.cache).toBe("no-store");
  });

  it("posts a complaint answer and a correction answer", async () => {
    reply(200);
    await clientApi.answerComplaint(ID, { text: "It was 40.", evidence: [{ mediaId: MEDIA, captureKind: "file_upload" }] });
    await clientApi.answerCorrection(ID, { text: "Photo attached.", mediaIds: [MEDIA] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/me/reports/complaint/${ID}/answer`);
    expect(JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ text: "It was 40.", evidence: [{ mediaId: MEDIA, captureKind: "file_upload" }] });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/v1/me/reports/correction/${ID}/answer`);
    expect(JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)).toEqual({ text: "Photo attached.", mediaIds: [MEDIA] });
  });

  it.each([
    [409, "changed", en.reports.api.changed],
    [400, "invalid", en.reports.api.invalid],
    [401, "signed_out", en.reports.api.signedOut],
    [404, "not_found", en.reports.api.notFound],
    [429, "rate_limited", en.reports.api.rateLimited],
    [500, "failed", en.reports.api.sendFailed],
  ])("status %i is %s", async (status, reason, message) => {
    reply(status, { error: { code: "x", message: "server words", requestId: "r" } });
    expect(await clientApi.answerComplaint(ID, { text: "a", evidence: [] })).toEqual({ ok: false, reason, message });
  });

  it("a network failure or an unexpected body is a failed send with the text-kept message", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await clientApi.withdrawComplaint(ID)).toEqual({ ok: false, reason: "failed", message: en.reports.api.sendFailed });
    reply(200, { nope: 1 });
    expect(await clientApi.withdrawComplaint(ID)).toMatchObject({ ok: false, reason: "failed" });
  });
});

describe("answering a driver report", () => {
  const open = async (c = complaint("needs_information")) => {
    api.loadComplaint.mockResolvedValue({ ok: true, data: c });
    render(<ReportDetailScreen kind="complaint" id={ID} />);
    return screen.findByTestId("answer-form");
  };

  it("replaces the old note with a labelled, required form; no new-report link", async () => {
    const form = await open();
    expect(within(form).getByLabelText("Your answer")).toHaveProperty("required", true);
    expect(screen.queryByText(/send a new driver report/i)).toBeNull();
    expect(within(form).getByTestId("answer-file-input").getAttribute("accept")).toContain("video/mp4");
  });

  it("refuses an empty answer, focuses the field and sends nothing", async () => {
    const form = await open();
    fireEvent.click(within(form).getByTestId("answer-send"));
    const text = within(form).getByLabelText("Your answer");
    expect(text.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(text);
    expect(within(form).getByTestId("answer-error").textContent).toBe(en.reports.answer.empty);
    expect(api.answerComplaint).not.toHaveBeenCalled();
  });

  it("sends the trimmed text with each uploaded file, reloads, and focuses the status message", async () => {
    uploads.complaint.mockResolvedValue({ ok: true, mediaId: MEDIA });
    const form = await open();
    api.answerComplaint.mockResolvedValue(ok);
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("under_review", { events: [{ status: "under_review", at: "2026-10-19T01:00:00.000Z", note: "It was 40 pesos.", own: true }] }) });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "  It was 40 pesos.  " } });
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo("clip.mp4", "video/mp4")] } });
    expect(within(form).getByTestId("answer-files").textContent).toContain("clip.mp4");
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(api.answerComplaint).toHaveBeenCalledWith(ID, { text: "It was 40 pesos.", evidence: [{ mediaId: MEDIA, captureKind: "file_upload" }] });
    await waitFor(() => expect(screen.queryByTestId("answer-form")).toBeNull());
    const status = screen.getByTestId("report-note");
    expect(status.textContent).toBe(en.reports.answer.sent);
    expect(status.getAttribute("role")).toBe("status");
    expect(document.activeElement).toBe(status);
    // The person's own answer is labelled in the timeline.
    expect(screen.getByTestId("report-timeline").textContent).toContain("You answered: It was 40 pesos.");
  });

  it("keeps the text and the uploaded file after a failed send; the retry does not upload again", async () => {
    uploads.complaint.mockResolvedValue({ ok: true, mediaId: MEDIA });
    const form = await open();
    api.answerComplaint.mockResolvedValueOnce({ ok: false, reason: "failed", message: en.reports.api.sendFailed });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "It was 40." } });
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo()] } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(within(form).getByTestId("answer-error").textContent).toBe(en.reports.api.sendFailed);
    expect(within(form).getByTestId("answer-error").getAttribute("role")).toBe("alert");
    expect((within(form).getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("It was 40.");

    api.answerComplaint.mockResolvedValueOnce(ok);
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(uploads.complaint).toHaveBeenCalledTimes(1);
    expect(api.answerComplaint).toHaveBeenLastCalledWith(ID, { text: "It was 40.", evidence: [{ mediaId: MEDIA, captureKind: "file_upload" }] });
  });

  it("an upload that fails stops before the answer and keeps the text", async () => {
    uploads.complaint.mockResolvedValue({ ok: false, message: en.driverReport.api.uploadFailed });
    const form = await open();
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "More." } });
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo()] } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(api.answerComplaint).not.toHaveBeenCalled();
    expect(within(form).getByTestId("answer-error").textContent).toBe(en.driverReport.api.uploadFailed);
    expect((within(form).getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("More.");
  });

  it("a second tap while sending sends once", async () => {
    const form = await open();
    let done!: (v: unknown) => void;
    api.answerComplaint.mockReturnValue(new Promise((r) => (done = r)));
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("under_review") });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "Once." } });
    fireEvent.click(within(form).getByTestId("answer-send"));
    fireEvent.click(within(form).getByTestId("answer-send"));
    expect(within(form).getByTestId("answer-send").getAttribute("aria-disabled")).toBe("true");
    expect(within(form).getByTestId("answer-send").textContent).toBe("Sending…");
    await act(async () => done(ok));
    expect(api.answerComplaint).toHaveBeenCalledTimes(1);
  });

  it("409: reloads, says the report changed and keeps the typed text in a read-only box", async () => {
    const form = await open();
    api.answerComplaint.mockResolvedValue({ ok: false, reason: "changed", message: en.reports.api.changed });
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("under_review") });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "My long answer." } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    await waitFor(() => expect(screen.queryByTestId("answer-form")).toBeNull());
    expect(screen.getByTestId("report-note").textContent).toBe(en.reports.api.changed);
    expect(document.activeElement).toBe(screen.getByTestId("report-note"));
    expect((within(screen.getByTestId("report-unsent")).getByLabelText("Your unsent answer") as HTMLTextAreaElement).value).toBe("My long answer.");
  });

  it("409 while still asked: the form stays, with the text, and can be sent again", async () => {
    const form = await open();
    api.answerComplaint.mockResolvedValueOnce({ ok: false, reason: "changed", message: en.reports.api.changed }).mockResolvedValueOnce(ok);
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("needs_information") });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "Asked again." } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(screen.getByTestId("report-note").textContent).toBe(en.reports.api.changed);
    expect((within(form).getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("Asked again.");
    expect(within(form).getByTestId("answer-send").textContent).toBe(en.reports.answer.send);
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(api.answerComplaint).toHaveBeenCalledTimes(2);
  });

  it("409 because the answer had arrived (its response was lost): says it was sent, no unsent box", async () => {
    const form = await open();
    api.answerComplaint.mockResolvedValue({ ok: false, reason: "changed", message: en.reports.api.changed });
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("under_review", { events: [{ status: "under_review", at: "2026-11-24T00:00:00.000Z", note: "It arrived.", own: true }] }) });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: " It arrived. " } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    await waitFor(() => expect(screen.queryByTestId("answer-form")).toBeNull());
    expect(screen.getByTestId("report-note").textContent).toBe(en.reports.answer.sent);
    expect(screen.queryByTestId("report-unsent")).toBeNull();
  });

  it("offers only as many files as the report can still take, and hides the picker when full", async () => {
    // 4 files already: room for 2 (6 in total).
    const form = await open(complaint("needs_information", { evidence: Array.from({ length: 4 }, (_, i) => ({ id: `e${i}`, captureKind: "file_upload" as const })) }));
    expect(form.textContent).toContain("You can add up to 2 more.");
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo("a.jpg"), photo("b.jpg"), photo("c.jpg")] } });
    expect(within(form).getByTestId("answer-files").querySelectorAll("li")).toHaveLength(2);
    expect(within(form).queryByTestId("answer-file-input")).toBeNull();
    // Remove one: the picker is back, and the remove buttons name their file.
    fireEvent.click(within(form).getByRole("button", { name: "Remove a.jpg" }));
    expect(within(form).getByTestId("answer-file-input")).toBeTruthy();
    cleanup();
    await open(complaint("needs_information", { evidence: Array.from({ length: 6 }, (_, i) => ({ id: `f${i}`, captureKind: "file_upload" as const })) }));
    expect(screen.queryByTestId("answer-file-input")).toBeNull();
  });

  it("refuses a file of the wrong type or size when it is chosen, by name", async () => {
    const form = await open();
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo("doc.pdf", "application/pdf")] } });
    expect(within(form).queryByTestId("answer-files")).toBeNull();
    expect(form.textContent).toContain(en.driverReport.api.badType);
  });
});

describe("answering a correction", () => {
  it("uses photos only, with the room left on the report, and sends their ids", async () => {
    api.loadCorrection.mockResolvedValue({ ok: true, data: correction("needs_evidence", { photoCount: 1 }) });
    render(<ReportDetailScreen kind="correction" id={ID} />);
    const form = await screen.findByTestId("answer-form");
    expect(within(form).getByTestId("answer-file-input").getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
    expect(form.textContent).toContain("You can add up to 2 more.");
    uploads.photo.mockResolvedValueOnce({ ok: true, mediaId: MEDIA }).mockResolvedValueOnce({ ok: true, mediaId: MEDIA2 });
    api.answerCorrection.mockResolvedValue(ok);
    api.loadCorrection.mockResolvedValue({ ok: true, data: correction("submitted", { events: [{ status: "submitted", at: "2026-10-20T00:00:00.000Z", reason: null, answer: "Here is a photo." }] }) });
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "Here is a photo." } });
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo("a.jpg"), photo("b.png", "image/png"), photo("c.jpg")] } });
    await act(async () => fireEvent.click(within(form).getByTestId("answer-send")));
    expect(api.answerCorrection).toHaveBeenCalledWith(ID, { text: "Here is a photo.", mediaIds: [MEDIA, MEDIA2] });
    await waitFor(() => expect(screen.queryByTestId("answer-form")).toBeNull());
    expect(screen.getByTestId("report-timeline").textContent).toContain("You answered: Here is a photo.");
    expect(document.activeElement).toBe(screen.getByTestId("report-note"));
  });
});

describe("withdrawing a driver report", () => {
  const open = async (status: ComplaintDetail["status"]) => {
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint(status) });
    render(<ReportDetailScreen kind="complaint" id={ID} />);
    await screen.findByTestId("report-timeline");
  };

  it.each(["submitted", "needs_information"] as const)("is offered while %s", async (status) => {
    await open(status);
    expect(screen.getByTestId("withdraw-open").textContent).toBe("Withdraw this report");
  });

  it("is not offered under review, with one line why; nor once closed", async () => {
    await open("under_review");
    expect(screen.queryByTestId("withdraw-open")).toBeNull();
    expect(screen.getByTestId("report-withdraw").textContent).toBe(en.reports.withdraw.underReview);
    cleanup();
    await open("closed");
    expect(screen.queryByTestId("report-withdraw")).toBeNull();
  });

  it("asks first, says what happens, and Cancel changes nothing", async () => {
    await open("submitted");
    fireEvent.click(screen.getByTestId("withdraw-open"));
    const dialog = screen.getByTestId("withdraw-dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("deleted after 30 days");
    expect(dialog.textContent).toContain("cannot undo");
    expect(dialog.textContent).toContain("legal hold");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(api.withdrawComplaint).not.toHaveBeenCalled();
  });

  it("confirming withdraws once, reloads and focuses the status message", async () => {
    await open("submitted");
    let done!: (v: unknown) => void;
    api.withdrawComplaint.mockReturnValue(new Promise((r) => (done = r)));
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("withdrawn") });
    fireEvent.click(screen.getByTestId("withdraw-open"));
    const confirm = within(screen.getByTestId("withdraw-dialog")).getByRole("button", { name: "Withdraw report" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await act(async () => done(ok));
    expect(api.withdrawComplaint).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("withdraw-open")).toBeNull());
    expect(screen.getByTestId("report-note").textContent).toBe(en.reports.withdraw.done);
    expect(document.activeElement).toBe(screen.getByTestId("report-note"));
  });

  it("a failure closes the dialog and shows an alert on the screen", async () => {
    await open("submitted");
    api.withdrawComplaint.mockResolvedValue({ ok: false, reason: "failed", message: en.reports.api.sendFailed });
    fireEvent.click(screen.getByTestId("withdraw-open"));
    await act(async () => fireEvent.click(within(screen.getByTestId("withdraw-dialog")).getByRole("button", { name: "Withdraw report" })));
    expect(screen.getByTestId("withdraw-error").getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("withdraw-dialog").hasAttribute("open")).toBe(false);
    expect(screen.getByTestId("withdraw-open")).toBeTruthy();
  });
});

describe("leaving the page", () => {
  it("drops the typed answer and the chosen files when the page is hidden and shown again", async () => {
    api.loadComplaint.mockResolvedValue({ ok: true, data: complaint("needs_information") });
    const view = render(
      <Activity mode="visible">
        <ReportDetailScreen kind="complaint" id={ID} />
      </Activity>,
    );
    const form = await screen.findByTestId("answer-form");
    fireEvent.change(within(form).getByLabelText("Your answer"), { target: { value: "Private words." } });
    fireEvent.change(within(form).getByTestId("answer-file-input"), { target: { files: [photo("secret.jpg")] } });
    // The router hides a page it leaves (Activity): effects clean up, the state would stay.
    view.rerender(
      <Activity mode="hidden">
        <ReportDetailScreen kind="complaint" id={ID} />
      </Activity>,
    );
    view.rerender(
      <Activity mode="visible">
        <ReportDetailScreen kind="complaint" id={ID} />
      </Activity>,
    );
    const again = await screen.findByTestId("answer-form");
    expect((within(again).getByLabelText("Your answer") as HTMLTextAreaElement).value).toBe("");
    expect(within(again).queryByTestId("answer-files")).toBeNull();
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain("Private");
  });
});
