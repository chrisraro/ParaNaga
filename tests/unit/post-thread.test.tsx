// @vitest-environment jsdom
// The post thread's actions (src/ui/community/post-thread.tsx): each action has its own in-flight
// key, so one never clears another's busy state or sends twice; answers patch the newest state, so
// two in a row both stay on screen; a sign-in check with no answer is never shown as signed out.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostDetail } from "@/domain/community/schemas";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";

type Toggle = { ok: true; data: { active: boolean; count: number | null } } | { ok: false; message: string };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const auth = vi.hoisted(() => ({
  current: { user: { id: "u1", name: "Ana", roles: [] } as unknown, loading: false, status: "signedIn", refresh: vi.fn(async () => undefined), refreshing: false },
}));
vi.mock("@/client/auth/use-auth-session", () => ({ useAuthSession: () => auth.current }));

const api = vi.hoisted(() => ({
  fetchPost: vi.fn(),
  fetchCommunityMe: vi.fn(async () => ({ ok: true, data: { guidelinesAccepted: true, blocked: [] } })),
  toggleHelpful: vi.fn(),
  toggleSaved: vi.fn(),
  blockPerson: vi.fn(),
  removeComment: vi.fn(),
  removePost: vi.fn(),
  reportPost: vi.fn(),
  submitAppeal: vi.fn(),
  submitComment: vi.fn(),
}));
vi.mock("@/client/community/api", () => api);

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { PostThread } = await import("@/ui/community/post-thread");

const detail = (): PostDetail => ({
  post: {
    id: POST_ID, seq: 1, topic: "commute_tips", title: "Seats", excerpt: "Seats", tags: [], routeCode: null, label: "community",
    authorHandle: "rider-2", isOwn: false, createdAt: "2026-11-01T00:00:00.000Z", helpfulCount: 3, commentCount: 1,
    viewerHelpful: false, viewerBookmarked: false, state: "published", hasPendingEdit: false,
    body: "Seats are easy to find.", versions: [], editDraft: null, photos: [],
  },
  comments: [
    { id: COMMENT_ID, parentId: null, depth: 1, authorHandle: "rider-3", isOwn: false, body: "True.", createdAt: "2026-11-02T00:00:00.000Z", helpfulCount: 0, viewerHelpful: false, state: "published", appeal: null, replies: [] },
  ],
});

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockClear();
  api.fetchPost.mockImplementation(async () => ({ ok: true, data: detail() }));
  auth.current = { ...auth.current, user: { id: "u1", name: "Ana", roles: [] }, status: "signedIn", refreshing: false };
});
afterEach(cleanup);

// aria-disabled, never disabled: the button keeps focus while its request runs.
const off = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" && !(el as HTMLButtonElement).disabled;
const helpful = () => screen.getByTestId("thread-helpful") as HTMLButtonElement;
const bookmark = () => screen.getByTestId("thread-bookmark") as HTMLButtonElement;

describe("post thread actions", () => {
  it("two actions in a row each keep their own busy state, and both answers stay on screen", async () => {
    const h = deferred<Toggle>();
    const b = deferred<Toggle>();
    api.toggleHelpful.mockReturnValue(h.promise);
    api.toggleSaved.mockReturnValue(b.promise);
    render(<PostThread id={POST_ID} />);
    await screen.findByTestId("thread-helpful");

    fireEvent.click(helpful());
    fireEvent.click(bookmark());
    expect(off(helpful())).toBe(true);
    expect(off(bookmark())).toBe(true);

    // The first answer leaves the second action busy; the second answer does not undo the first.
    await act(async () => h.resolve({ ok: true, data: { active: true, count: 4 } }));
    expect(off(helpful())).toBe(false);
    expect(off(bookmark())).toBe(true);
    await act(async () => b.resolve({ ok: true, data: { active: true, count: null } }));
    expect(helpful().getAttribute("aria-pressed")).toBe("true");
    expect(helpful().textContent).toContain("4");
    expect(bookmark().getAttribute("aria-pressed")).toBe("true");
    expect(off(bookmark())).toBe(false);
  });

  // The dialog's own buttons: Block this person (first), Cancel. A closed <dialog> hides them from role queries.
  const confirmBlock = () => within(screen.getByTestId("block-confirm")).getAllByRole("button", { hidden: true });

  it("Block asks first, says what happens, and Cancel sends nothing", async () => {
    render(<PostThread id={POST_ID} />);
    fireEvent.click(await screen.findByTestId("thread-block"));
    const dialog = screen.getByTestId("block-confirm");
    expect(dialog.textContent).toContain("Block this person?");
    expect(dialog.textContent).toContain("You can unblock them at the bottom of the community feed.");
    expect(api.blockPerson).not.toHaveBeenCalled();
    fireEvent.click(confirmBlock()[1]!);
    expect(api.blockPerson).not.toHaveBeenCalled();
  });

  it("Block is sent once however often it is confirmed, and is off while it runs", async () => {
    const pending = deferred<{ ok: false; message: string }>();
    api.blockPerson.mockReturnValue(pending.promise);
    render(<PostThread id={POST_ID} />);
    const block = (await screen.findByTestId("thread-block")) as HTMLButtonElement;
    fireEvent.click(block);
    fireEvent.click(confirmBlock()[0]!);
    fireEvent.click(block);
    fireEvent.click(block);
    expect(api.blockPerson).toHaveBeenCalledTimes(1);
    expect(off(block)).toBe(true);
    // A failure shows its message; the next action clears it.
    await act(async () => pending.resolve({ ok: false, message: "Could not block. Try again." }));
    expect(off(block)).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("Could not block. Try again.");
    api.toggleSaved.mockReturnValue(deferred<Toggle>().promise);
    fireEvent.click(bookmark());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("opening a reply keeps what was typed in the main comment box, and Escape keeps a reply that has text", async () => {
    render(<PostThread id={POST_ID} />);
    const main = (await screen.findByLabelText("Your comment")) as HTMLTextAreaElement;
    fireEvent.change(main, { target: { value: "My long comment" } });

    fireEvent.click(screen.getByTestId("comment-reply"));
    const reply = screen.getByLabelText("Your reply") as HTMLTextAreaElement;
    // Hidden while the reply is open, not removed.
    expect(main.isConnected).toBe(true);
    expect(main.closest("[hidden]")).not.toBeNull();

    // Escape on an empty reply closes it; on one with text it does nothing.
    fireEvent.keyDown(reply, { key: "Escape" });
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    fireEvent.click(screen.getByTestId("comment-reply"));
    fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: "Thanks" } });
    fireEvent.keyDown(screen.getByLabelText("Your reply"), { key: "Escape" });
    expect((screen.getByLabelText("Your reply") as HTMLTextAreaElement).value).toBe("Thanks");

    // Cancel is the way out; the main box still has its text.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    const back = screen.getByLabelText("Your comment") as HTMLTextAreaElement;
    expect(back.value).toBe("My long comment");
    expect(back.closest("[hidden]")).toBeNull();
  });

  it("a reply whose comment went away (blocked) no longer hides the main box or refuses another reply", async () => {
    const OTHER_ID = "33333333-3333-4333-8333-333333333333";
    const two = detail();
    two.comments.push({ ...two.comments[0]!, id: OTHER_ID, authorHandle: "rider-4", body: "Agreed." });
    api.fetchPost.mockResolvedValueOnce({ ok: true, data: two });
    api.blockPerson.mockResolvedValue({ ok: true });
    render(<PostThread id={POST_ID} />);
    const [first] = await screen.findAllByTestId("comment");
    fireEvent.click(within(first!).getByTestId("comment-reply"));
    fireEvent.change(screen.getByLabelText("Your reply"), { target: { value: "Thanks" } });

    // Blocking the person reloads the thread without their comment (the reply box goes with it).
    api.fetchPost.mockResolvedValueOnce({ ok: true, data: { ...two, comments: [two.comments[1]!] } });
    fireEvent.click(within(first!).getAllByRole("button", { hidden: true }).find((b) => b.textContent === "Block this person")!);
    await act(async () => fireEvent.click(confirmBlock()[0]!));
    await act(async () => undefined);
    expect(screen.getAllByTestId("comment")).toHaveLength(1);
    expect(screen.queryByLabelText("Your reply")).toBeNull();
    expect(screen.getByLabelText("Your comment").closest("[hidden]")).toBeNull();

    // The lost reply's text does not count as an open draft.
    fireEvent.click(screen.getByTestId("comment-reply"));
    expect((screen.getByLabelText("Your reply") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("focus goes to the error message when a reload fails and the focused control is gone", async () => {
    api.toggleHelpful.mockResolvedValue({ ok: true, data: { active: true, count: 1 } });
    render(<PostThread id={POST_ID} />);
    const comment = await screen.findByTestId("comment");
    api.fetchPost.mockResolvedValueOnce({ ok: false, message: "Could not load this post. Try again.", reason: "failed" });
    // Focus is on the page body, as when the control that had it was removed.
    await act(async () => fireEvent.click(within(comment).getByRole("button", { name: /Helpful/ })));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Could not load this post. Try again.");
    expect(document.activeElement).toBe(alert);
  });

  it("a sign-in check with no answer offers Try again under the comments, never the sign-in prompt", async () => {
    auth.current = { ...auth.current, user: null, status: "unknown" };
    const view = render(<PostThread id={POST_ID} />);
    const box = await screen.findByTestId("signin-unknown");
    expect(screen.queryByTestId("community-signin")).toBeNull();
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Couldn't check your sign-in. Check your connection, then try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(auth.current.refresh).toHaveBeenCalledTimes(1);

    // While the retry runs: the button is off and the status line says so.
    auth.current = { ...auth.current, refreshing: true };
    view.rerender(<PostThread id={POST_ID} />);
    expect(off(screen.getByRole("button", { name: "Try again" }))).toBe(true);
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Checking…");

    auth.current = { ...auth.current, status: "signedOut", refreshing: false };
    view.rerender(<PostThread id={POST_ID} />);
    expect(screen.getByTestId("community-signin")).toBeTruthy();
    expect(screen.queryByTestId("signin-unknown")).toBeNull();
  });

  it("ties a comment error to its field, and Cancel on a reply returns to its Reply button", async () => {
    render(<PostThread id={POST_ID} />);
    fireEvent.click(await screen.findByTestId("comment-send"));
    const field = screen.getByLabelText("Your comment");
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby")!)!.textContent).toBeTruthy();
    // Read as the focused field's description, so not also an alert.
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(field, { target: { value: "Hello" } });
    expect(field.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByTestId("comment-reply"));
    const reply = screen.getByLabelText("Your reply");
    expect(document.activeElement).toBe(reply);
    reply.focus();
    screen.getByRole("button", { name: "Cancel" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(screen.getByTestId("comment-reply"));
  });

  it("a sent report moves focus to its result", async () => {
    api.reportPost.mockResolvedValue({ ok: true });
    render(<PostThread id={POST_ID} />);
    fireEvent.click(await screen.findByTestId("thread-report"));
    const send = screen.getByTestId("report-send");
    fireEvent.click(send);
    expect(document.activeElement).toBe(screen.getAllByRole("radio")[0]);
    expect(screen.getByRole("radiogroup").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    expect(screen.getByRole("radiogroup").getAttribute("aria-invalid")).toBe("false");
    send.focus();
    await act(async () => fireEvent.click(send));
    expect(document.activeElement).toBe(screen.getByText(/Report sent/));
  });
});
