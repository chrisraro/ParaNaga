import "server-only";
import { sql } from "drizzle-orm";
import { parseUuidParam } from "@/domain/api/schemas";
import { GUIDELINES_KIND, GUIDELINES_VERSION } from "@/domain/community/guidelines";
import {
  blockPayloadSchema,
  blockResponseSchema,
  bookmarkPayloadSchema,
  createCommentPayloadSchema,
  createPostPayloadSchema,
  editPostPayloadSchema,
  okResponseSchema,
  reactionPayloadSchema,
  reportPayloadSchema,
  submitCommentResponseSchema,
  submitPostResponseSchema,
  toggleResponseSchema,
} from "@/domain/community/schemas";
import { contentState } from "@/domain/community/status";
import { authedRoute, ApiProblem, badRequest, CACHE, notFound, readJsonBody, tooManyRequests } from "@/server/api/http";
import { authorize } from "@/server/auth/authorize";
import { withRequestContext, type Db } from "@/server/db/context";
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from "@/server/ratelimit/rate-limiter";
import { moderateCommunityText } from "./moderate";

const POST_BODY_MAX_BYTES = 16384;
const SMALL_BODY_MAX_BYTES = 2048;

const noStore = (requestId: string) => ({ "Cache-Control": CACHE.none, "X-Request-Id": requestId });

/** Postgres error code, whether the driver error is wrapped or not. */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Definer functions signal: P0002 not found, 42501 not yours, 22023 not allowed. "Not yours" answers
 * the same 404 as "not found", so a caller cannot probe whether someone else's post exists (B10).
 */
async function guarded<T>(run: () => Promise<T>, messages: { invalid?: string } = {}): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = pgCode(error);
    if (code === "P0002") throw notFound("This is no longer available.");
    if (code === "42501") throw notFound("This is no longer available.");
    if (code === "22023") throw badRequest(messages.invalid ?? "That is not allowed.");
    throw error;
  }
}

const pgTextArray = (values: readonly string[]) => `{${values.join(",")}}`; // tags are [a-z0-9-] only

type Gate = "ok" | "rate_limited" | "guidelines_required";

/** Rate limits, then the guidelines acknowledgement (recorded the first time it is accepted). */
async function gate(db: Db, request: Request, userId: string, limits: readonly RateLimitConfig[], accepted: boolean): Promise<Gate> {
  for (const limit of [RATE_LIMITS.mutationPerMinute, ...limits]) {
    if (!(await checkRateLimit(db, request, limit, userId))) return "rate_limited";
  }
  const seen = await db.execute<{ one: number }>(sql`
    select 1 as one from core.ack
     where user_id = ${userId} and kind = ${GUIDELINES_KIND} and version = ${GUIDELINES_VERSION}
  `);
  if (seen.rows.length > 0) return "ok";
  if (!accepted) return "guidelines_required";
  await db.execute(sql`
    insert into core.ack (user_id, kind, version)
    values (${userId}, ${GUIDELINES_KIND}, ${GUIDELINES_VERSION})
    on conflict (user_id, kind, version) do nothing
  `);
  return "ok";
}

function throwGate(result: Gate): void {
  if (result === "rate_limited") throw tooManyRequests("You are posting too quickly. Please wait a moment.");
  if (result === "guidelines_required") throw badRequest("Read and accept the community guidelines first.");
}

const rateGate = async (request: Request, userId: string, requestId: string, limits: readonly RateLimitConfig[]) =>
  withRequestContext({ userId, requestId }, async (db) => {
    for (const limit of [RATE_LIMITS.mutationPerMinute, ...limits]) {
      if (!(await checkRateLimit(db, request, limit, userId))) return false;
    }
    return true;
  });

// ---------------------------------------------------------------- posts
type PostResultRow = { post_id: string; version_id: string; status: string };

/** POST /api/v1/community/posts: authorize, strict body, limits, guidelines, Jev (advisory), write. */
export function createPost(request: Request): Promise<Response> {
  return authedRoute(request, "community-post-create", async (requestId) => {
    const user = await authorize("community.post");
    const parsed = createPostPayloadSchema.safeParse(await readJsonBody(request, POST_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the post and try again.");
    const input = parsed.data;

    throwGate(
      await withRequestContext({ userId: user.id, requestId }, (db) =>
        gate(db, request, user.id, [RATE_LIMITS.communityPostPerHour], input.guidelinesAccepted),
      ),
    );

    const decision = await moderateCommunityText(`${input.title}\n${input.body}`);
    const row = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<PostResultRow>(sql`
          select * from community.create_post(
            ${input.clientRequestId}::uuid, ${input.topic}, ${input.title}, ${input.body},
            ${pgTextArray(input.tags)}::text[], ${input.routeCode ?? null}::text, ${decision.status}, ${decision.reason}
          )
        `);
        return res.rows[0];
      }),
    );
    if (!row) throw new ApiProblem(503, "unavailable", "The post could not be saved. Try again.");
    const state = contentState(row.status);
    const body = submitPostResponseSchema.parse({ post: { id: row.post_id, state, isEdit: false, visibleToOthers: state === "published" } });
    return Response.json(body, { status: 201, headers: noStore(requestId) });
  });
}

type EditResultRow = { post_id: string; version_id: string; n: number; status: string; is_live: boolean };

/**
 * PATCH /api/v1/community/posts/:id: an edit becomes a new version. While it waits, the published
 * version stays visible to everyone (the SQL function never touches it).
 */
export function editPost(request: Request, rawId: string): Promise<Response> {
  return authedRoute(request, "community-post-edit", async (requestId) => {
    const user = await authorize("community.post");
    const id = parseUuidParam(rawId, "id");
    if (!id.ok) throw badRequest(id.message);
    const parsed = editPostPayloadSchema.safeParse(await readJsonBody(request, POST_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the post and try again.");
    const input = parsed.data;

    throwGate(
      await withRequestContext({ userId: user.id, requestId }, (db) =>
        gate(db, request, user.id, [RATE_LIMITS.communityPostPerHour], input.guidelinesAccepted),
      ),
    );

    const decision = await moderateCommunityText(`${input.title}\n${input.body}`);
    const row = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<EditResultRow>(sql`
          select * from community.edit_post(
            ${id.value}::uuid, ${input.clientRequestId}::uuid, ${input.title}, ${input.body},
            ${pgTextArray(input.tags)}::text[], ${decision.status}, ${decision.reason}
          )
        `);
        return res.rows[0];
      }),
    );
    if (!row) throw new ApiProblem(503, "unavailable", "The edit could not be saved. Try again.");
    const state = contentState(row.status);
    const body = submitPostResponseSchema.parse({ post: { id: row.post_id, state, isEdit: true, visibleToOthers: row.is_live } });
    return Response.json(body, { headers: noStore(requestId) });
  });
}

/** DELETE /api/v1/community/posts/:id: the author removes their own post. */
export function deletePost(request: Request, rawId: string): Promise<Response> {
  return authedRoute(request, "community-post-delete", async (requestId) => {
    const user = await authorize("community.post");
    const id = parseUuidParam(rawId, "id");
    if (!id.ok) throw badRequest(id.message);
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const done = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<{ done: boolean }>(sql`select community.delete_post(${id.value}::uuid) as done`);
        return res.rows[0]?.done === true;
      }),
    );
    if (!done) throw notFound("This post is not available.");
    return Response.json(okResponseSchema.parse({ ok: true }), { headers: noStore(requestId) });
  });
}

// ---------------------------------------------------------------- comments
type CommentResultRow = { comment_id: string; status: string; depth: number };

/** POST /api/v1/community/posts/:id/comments (a reply sets parentCommentId; two levels at most). */
export function createComment(request: Request, rawPostId: string): Promise<Response> {
  return authedRoute(request, "community-comment-create", async (requestId) => {
    const user = await authorize("community.post");
    const postId = parseUuidParam(rawPostId, "id");
    if (!postId.ok) throw badRequest(postId.message);
    const parsed = createCommentPayloadSchema.safeParse(await readJsonBody(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the comment and try again.");
    const input = parsed.data;

    throwGate(
      await withRequestContext({ userId: user.id, requestId }, (db) =>
        gate(db, request, user.id, [RATE_LIMITS.communityCommentPerHour], input.guidelinesAccepted),
      ),
    );

    const decision = await moderateCommunityText(input.body);
    const row = await guarded(
      () =>
        withRequestContext({ userId: user.id, requestId }, async (db) => {
          const res = await db.execute<CommentResultRow>(sql`
            select * from community.create_comment(
              ${input.clientRequestId}::uuid, ${postId.value}::uuid, ${input.parentCommentId ?? null}::uuid,
              ${input.body}, ${decision.status}, ${decision.reason}
            )
          `);
          return res.rows[0];
        }),
      { invalid: "You can reply to a comment, but not to a reply." },
    );
    if (!row) throw new ApiProblem(503, "unavailable", "The comment could not be saved. Try again.");
    const body = submitCommentResponseSchema.parse({ comment: { id: row.comment_id, state: contentState(row.status), depth: Number(row.depth) } });
    return Response.json(body, { status: 201, headers: noStore(requestId) });
  });
}

/** DELETE /api/v1/community/comments/:id */
export function deleteComment(request: Request, rawId: string): Promise<Response> {
  return authedRoute(request, "community-comment-delete", async (requestId) => {
    const user = await authorize("community.post");
    const id = parseUuidParam(rawId, "id");
    if (!id.ok) throw badRequest(id.message);
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const done = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<{ done: boolean }>(sql`select community.delete_comment(${id.value}::uuid) as done`);
        return res.rows[0]?.done === true;
      }),
    );
    if (!done) throw notFound("This comment is not available.");
    return Response.json(okResponseSchema.parse({ ok: true }), { headers: noStore(requestId) });
  });
}

// ---------------------------------------------------------------- reactions, bookmarks, blocks, reports
/** POST /api/v1/community/reactions: toggles "helpful" on a published post or comment. */
export function toggleReaction(request: Request): Promise<Response> {
  return authedRoute(request, "community-reaction", async (requestId) => {
    const user = await authorize("community.post");
    const parsed = reactionPayloadSchema.safeParse(await readJsonBody(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the request and try again.");
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const row = await guarded(
      () =>
        withRequestContext({ userId: user.id, requestId }, async (db) => {
          const res = await db.execute<{ active: boolean; helpful_count: number }>(sql`
            select * from community.toggle_reaction(${parsed.data.targetType}, ${parsed.data.targetId}::uuid)
          `);
          return res.rows[0];
        }),
      { invalid: "You cannot mark your own post or comment as helpful." },
    );
    if (!row) throw new ApiProblem(503, "unavailable", "Try again.");
    return Response.json(toggleResponseSchema.parse({ active: row.active, count: row.helpful_count }), { headers: noStore(requestId) });
  });
}

/** POST /api/v1/community/bookmarks: toggles a bookmark on a published post. */
export function toggleBookmark(request: Request): Promise<Response> {
  return authedRoute(request, "community-bookmark", async (requestId) => {
    const user = await authorize("community.post");
    const parsed = bookmarkPayloadSchema.safeParse(await readJsonBody(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the request and try again.");
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const active = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<{ active: boolean }>(sql`select community.toggle_bookmark(${parsed.data.postId}::uuid) as active`);
        return res.rows[0]?.active === true;
      }),
    );
    return Response.json(toggleResponseSchema.parse({ active, count: null }), { headers: noStore(requestId) });
  });
}

/** POST /api/v1/community/blocks: block the author of a post or comment (their id is never sent to the client). */
export function blockAuthor(request: Request): Promise<Response> {
  return authedRoute(request, "community-block", async (requestId) => {
    const user = await authorize("community.post");
    const parsed = blockPayloadSchema.safeParse(await readJsonBody(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Check the request and try again.");
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const row = await guarded(
      () =>
        withRequestContext({ userId: user.id, requestId }, async (db) => {
          const res = await db.execute<{ block_id: string; handle: string }>(sql`
            select * from community.block_author(${parsed.data.targetType}, ${parsed.data.targetId}::uuid)
          `);
          return res.rows[0];
        }),
      { invalid: "You cannot block yourself." },
    );
    if (!row) throw new ApiProblem(503, "unavailable", "Try again.");
    return Response.json(blockResponseSchema.parse({ block: { id: row.block_id, handle: row.handle } }), { status: 201, headers: noStore(requestId) });
  });
}

/** DELETE /api/v1/community/blocks/:id */
export function unblock(request: Request, rawId: string): Promise<Response> {
  return authedRoute(request, "community-unblock", async (requestId) => {
    const user = await authorize("community.post");
    const id = parseUuidParam(rawId, "id");
    if (!id.ok) throw badRequest(id.message);
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    const done = await guarded(() =>
      withRequestContext({ userId: user.id, requestId }, async (db) => {
        const res = await db.execute<{ done: boolean }>(sql`select community.unblock(${id.value}::uuid) as done`);
        return res.rows[0]?.done === true;
      }),
    );
    if (!done) throw notFound("This block is not available.");
    return Response.json(okResponseSchema.parse({ ok: true }), { headers: noStore(requestId) });
  });
}

/** POST /api/v1/community/reports: a report is stored for a moderator; the reporter stays private. */
export function reportContent(request: Request): Promise<Response> {
  return authedRoute(request, "community-report", async (requestId) => {
    const user = await authorize("community.post");
    const parsed = reportPayloadSchema.safeParse(await readJsonBody(request, SMALL_BODY_MAX_BYTES));
    if (!parsed.success) throw badRequest("Choose a reason and try again.");
    if (!(await rateGate(request, user.id, requestId, []))) throw tooManyRequests();
    await guarded(
      () =>
        withRequestContext({ userId: user.id, requestId }, async (db) => {
          await db.execute(sql`
            select community.report_content(${parsed.data.targetType}, ${parsed.data.targetId}::uuid,
                                            ${parsed.data.reason}, ${parsed.data.note ?? null}::text)
          `);
        }),
      { invalid: "You cannot report your own post or comment." },
    );
    // A repeat report is accepted silently: the answer is the same either way.
    return Response.json(okResponseSchema.parse({ ok: true }), { status: 201, headers: noStore(requestId) });
  });
}
