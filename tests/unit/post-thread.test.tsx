// @vitest-environment jsdom
// The post thread's actions (src/ui/community/post-thread.tsx): each action has its own in-flight
// key, so one never clears another's busy state or sends twice; answers patch the newest state, so
// two in a row both stay on screen; a sign-in check with no answer is never shown as signed out.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(helpful().disabled).toBe(true);
    expect(bookmark().disabled).toBe(true);

    // The first answer leaves the second action busy; the second answer does not undo the first.
    await act(async () => h.resolve({ ok: true, data: { active: true, count: 4 } }));
    expect(helpful().disabled).toBe(false);
    expect(bookmark().disabled).toBe(true);
    await act(async () => b.resolve({ ok: true, data: { active: true, count: null } }));
    expect(helpful().getAttribute("aria-pressed")).toBe("true");
    expect(helpful().textContent).toContain("4");
    expect(bookmark().getAttribute("aria-pressed")).toBe("true");
    expect(bookmark().disabled).toBe(false);
  });

  it("Block is sent once however often it is tapped, and is off while it runs", async () => {
    const pending = deferred<{ ok: false; message: string }>();
    api.blockPerson.mockReturnValue(pending.promise);
    render(<PostThread id={POST_ID} />);
    const block = (await screen.findByTestId("thread-block")) as HTMLButtonElement;
    fireEvent.click(block);
    fireEvent.click(block);
    expect(api.blockPerson).toHaveBeenCalledTimes(1);
    expect(block.disabled).toBe(true);
    // A failure shows its message; the next action clears it.
    await act(async () => pending.resolve({ ok: false, message: "Could not block. Try again." }));
    expect(block.disabled).toBe(false);
    expect(screen.getByRole("alert").textContent).toBe("Could not block. Try again.");
    api.toggleSaved.mockReturnValue(deferred<Toggle>().promise);
    fireEvent.click(bookmark());
    expect(screen.queryByRole("alert")).toBeNull();
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
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true);
    expect(box.querySelector('[role="status"]')!.textContent).toBe("Checking…");

    auth.current = { ...auth.current, status: "signedOut", refreshing: false };
    view.rerender(<PostThread id={POST_ID} />);
    expect(screen.getByTestId("community-signin")).toBeTruthy();
    expect(screen.queryByTestId("signin-unknown")).toBeNull();
  });
});
