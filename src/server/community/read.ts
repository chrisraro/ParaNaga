import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { GUIDELINES_KIND, GUIDELINES_VERSION } from "@/domain/community/guidelines";
import {
  communityMeSchema,
  excerptOf,
  feedQuerySchema,
  feedResponseSchema,
  FEED_PAGE_SIZE,
  postDetailSchema,
  type CommentDto,
  type FeedQuery,
  type PostSummary,
} from "@/domain/community/schemas";
import { contentState } from "@/domain/community/status";
import { hideBlocked, nestComments, type ThreadNode } from "@/domain/community/thread";
import { parseUuidParam } from "@/domain/api/schemas";
import { authorize } from "@/server/auth/authorize";
import { getCurrentUser } from "@/server/auth/session";
import { authedRoute, badRequest, CACHE, notFound } from "@/server/api/http";
import { withRequestContext, type Db } from "@/server/db/context";

type PostRow = {
  id: string;
  seq: string | number;
  topic: string;
  route_code: string | null;
  label: string;
  helpful_count: number;
  created_at: string | Date;
  author_handle: string;
  is_own: boolean | null;
  title: string;
  body: string;
  tags: string[] | null;
  moderation_status: string;
  comment_count: number;
  viewer_helpful: boolean | null;
  viewer_bookmarked: boolean | null;
  has_pending_edit: boolean | null;
};

const iso = (d: string | Date) => new Date(d).toISOString();

function toSummary(r: PostRow): PostSummary {
  return {
    id: r.id,
    seq: Number(r.seq),
    topic: r.topic as PostSummary["topic"],
    title: r.title,
    excerpt: excerptOf(r.body),
    tags: r.tags ?? [],
    routeCode: r.route_code,
    label: r.label as PostSummary["label"],
    authorHandle: r.author_handle,
    isOwn: r.is_own === true,
    createdAt: iso(r.created_at),
    helpfulCount: r.helpful_count,
    commentCount: r.comment_count,
    viewerHelpful: r.viewer_helpful === true,
    viewerBookmarked: r.viewer_bookmarked === true,
    state: contentState(r.moderation_status),
    hasPendingEdit: r.has_pending_edit === true,
  };
}

/** The post columns plus the version a reader sees: the live one, else (own posts) the latest. */
function postSelect(viewer: string | null, bodyChars: number | null): SQL {
  const body = bodyChars === null ? sql`v.body` : sql`left(v.body, ${bodyChars})`;
  return sql`
    select p.id, p.seq, p.topic, p.route_code, p.label, p.helpful_count, p.created_at, p.author_id,
           community.handle(p.author_id) as author_handle,
           (p.author_id = ${viewer}::text) as is_own,
           v.title, ${body} as body, v.tags, v.moderation_status,
           (select count(*)::int from community.comment c
             where c.post_id = p.id and c.deleted_at is null and c.moderation_status = 'published') as comment_count,
           exists (select 1 from community.reaction r
                    where r.user_id = ${viewer}::text and r.target_type = 'post' and r.target_id = p.id) as viewer_helpful,
           exists (select 1 from community.bookmark b
                    where b.user_id = ${viewer}::text and b.post_id = p.id) as viewer_bookmarked,
           (p.author_id = ${viewer}::text and exists (
              select 1 from community.post_version nv
               where nv.post_id = p.id and nv.moderation_status in ('pending', 'human_review') and nv.n > v.n)) as has_pending_edit
      from community.post p
      join lateral (
        select pv.* from community.post_version pv
         where pv.post_id = p.id
           and (pv.id = p.published_version_id
                or (p.published_version_id is null and pv.moderation_status <> 'superseded'))
         order by pv.n desc
         limit 1
      ) v on true
  `;
}

const notBlocked = (viewer: string | null): SQL => sql`not exists (
  select 1 from community.user_block ub where ub.blocker_id = ${viewer}::text and ub.blocked_id = p.author_id)`;

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

export async function fetchFeed(db: Db, viewer: string | null, query: FeedQuery) {
  const where: SQL[] = [sql`p.deleted_at is null`];
  if (query.scope === "mine") {
    where.push(sql`p.author_id = ${viewer}::text`);
  } else {
    where.push(sql`p.published_version_id is not null`, notBlocked(viewer));
    if (query.scope === "saved") {
      where.push(sql`exists (select 1 from community.bookmark sb where sb.post_id = p.id and sb.user_id = ${viewer}::text)`);
    }
  }
  if (query.topic) where.push(sql`p.topic = ${query.topic}`);
  if (query.tag) where.push(sql`${query.tag}::text = any (v.tags)`);
  if (query.q) {
    const pattern = likePattern(query.q);
    where.push(sql`(v.title ilike ${pattern} escape '\\' or v.body ilike ${pattern} escape '\\')`);
  }
  if (query.cursor) where.push(sql`p.seq < ${query.cursor}`);

  const res = await db.execute<PostRow>(sql`
    ${postSelect(viewer, 400)}
     where ${sql.join(where, sql` and `)}
     order by p.seq desc
     limit ${FEED_PAGE_SIZE + 1}
  `);
  const page = res.rows.slice(0, FEED_PAGE_SIZE).map(toSummary);
  const last = page[page.length - 1];
  return { posts: page, nextCursor: res.rows.length > FEED_PAGE_SIZE && last ? last.seq : null };
}

type CommentRow = {
  id: string;
  parent_comment_id: string | null;
  depth: number;
  author_id: string;
  author_handle: string;
  is_own: boolean | null;
  body: string;
  moderation_status: string;
  created_at: string | Date;
  helpful_count: number;
  viewer_helpful: boolean | null;
};

type VersionRow = {
  id: string;
  n: number;
  title: string;
  body: string;
  tags: string[] | null;
  moderation_status: string;
  submitted_at: string | Date;
  is_live: boolean | null;
};

type CommentNode = ThreadNode<{ id: string; parentId: string | null; depth: number; authorId: string; dto: Omit<CommentDto, "replies" | "parentId" | "depth" | "id"> }>;

function toCommentDto(node: CommentNode): CommentDto {
  return { id: node.id, parentId: node.parentId, depth: node.depth, ...node.dto, replies: node.replies.map(toCommentDto) };
}

export async function fetchThread(db: Db, viewer: string | null, postId: string) {
  const found = await db.execute<PostRow & { author_id: string }>(sql`
    ${postSelect(viewer, null)}
     where p.id = ${postId}::uuid and p.deleted_at is null
       and (p.published_version_id is not null or p.author_id = ${viewer}::text)
  `);
  const row = found.rows[0];
  if (!row) return null;
  const isOwn = row.is_own === true;

  const blockedRes = await db.execute<{ blocked_id: string }>(sql`
    select blocked_id from community.user_block where blocker_id = ${viewer}::text
  `);
  const blocked = new Set(blockedRes.rows.map((r) => r.blocked_id));
  if (!isOwn && blocked.has(row.author_id)) return null;

  const commentsRes = await db.execute<CommentRow>(sql`
    select c.id, c.parent_comment_id, c.depth, c.author_id, community.handle(c.author_id) as author_handle,
           (c.author_id = ${viewer}::text) as is_own, c.body, c.moderation_status, c.created_at, c.helpful_count,
           exists (select 1 from community.reaction r
                    where r.user_id = ${viewer}::text and r.target_type = 'comment' and r.target_id = c.id) as viewer_helpful
      from community.comment c
     where c.post_id = ${postId}::uuid and c.deleted_at is null
       and (c.moderation_status = 'published' or c.author_id = ${viewer}::text)
     order by c.created_at, c.id
  `);
  const rows = commentsRes.rows.map((c) => ({
    id: c.id,
    parentId: c.parent_comment_id,
    depth: Number(c.depth),
    authorId: c.author_id,
    dto: {
      authorHandle: c.author_handle,
      isOwn: c.is_own === true,
      body: c.body,
      createdAt: iso(c.created_at),
      helpfulCount: c.helpful_count,
      viewerHelpful: c.viewer_helpful === true,
      state: contentState(c.moderation_status),
    },
  }));
  const comments = nestComments(hideBlocked(rows, blocked, viewer)).map((n) => toCommentDto(n as CommentNode));

  let versions: { n: number; title: string; state: ReturnType<typeof contentState>; isLive: boolean; submittedAt: string }[] = [];
  let editDraft: { title: string; body: string; tags: string[] } | null = null;
  if (isOwn && viewer) {
    const vres = await db.execute<VersionRow>(sql`
      select pv.id, pv.n, pv.title, pv.body, pv.tags, pv.moderation_status, pv.submitted_at,
             (pv.id = p.published_version_id) as is_live
        from community.post_version pv
        join community.post p on p.id = pv.post_id
       where pv.post_id = ${postId}::uuid and pv.author_id = ${viewer}::text
       order by pv.n desc
    `);
    versions = vres.rows.map((v) => ({
      n: v.n,
      title: v.title,
      state: contentState(v.moderation_status),
      isLive: v.is_live === true,
      submittedAt: iso(v.submitted_at),
    }));
    const latest = vres.rows.find((v) => v.moderation_status !== "superseded");
    if (latest) editDraft = { title: latest.title, body: latest.body, tags: latest.tags ?? [] };
  }

  return { post: { ...toSummary(row), body: row.body, versions, editDraft }, comments };
}

export async function fetchMe(db: Db, viewer: string) {
  const ack = await db.execute<{ one: number }>(sql`
    select 1 as one from core.ack
     where user_id = ${viewer} and kind = ${GUIDELINES_KIND} and version = ${GUIDELINES_VERSION}
  `);
  const blocks = await db.execute<{ id: string; handle: string }>(sql`
    select id, community.handle(blocked_id) as handle
      from community.user_block where blocker_id = ${viewer} order by created_at
  `);
  return { guidelinesAccepted: ack.rows.length > 0, blocked: blocks.rows.map((b) => ({ id: b.id, handle: b.handle })) };
}

const noStore = (requestId: string) => ({ "Cache-Control": CACHE.none, "X-Request-Id": requestId });

/**
 * GET /api/v1/community/posts: the feed. Without ?me=1 it is the same for everyone (published
 * posts only, no block filtering, no personal flags) and may be cached for 30 s. ?me=1 and the
 * "mine" / "saved" scopes are personal and never cached.
 */
export function listPosts(request: Request): Promise<Response> {
  return authedRoute(request, "community-feed", async (requestId) => {
    const url = new URL(request.url);
    const parsed = feedQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) throw badRequest("Check the filters and try again.");
    const query = parsed.data;
    const personal = query.me === "1" || query.scope !== "all";
    const user = personal ? (query.scope === "all" ? await getCurrentUser() : await authorize("community.post")) : null;
    const viewer = user?.id ?? null;
    const body = await withRequestContext({ userId: viewer, requestId }, (db) => fetchFeed(db, viewer, query), { readOnly: true });
    return Response.json(feedResponseSchema.parse(body), {
      headers: personal ? noStore(requestId) : { "Cache-Control": CACHE.head, "X-Request-Id": requestId },
    });
  });
}

/** GET /api/v1/community/posts/:id (?me=1 for the signed-in view). */
export function getPost(request: Request, rawId: string): Promise<Response> {
  return authedRoute(request, "community-post", async (requestId) => {
    const id = parseUuidParam(rawId, "id");
    if (!id.ok) throw badRequest(id.message);
    const personal = new URL(request.url).searchParams.get("me") === "1";
    const user = personal ? await getCurrentUser() : null;
    const viewer = user?.id ?? null;
    const detail = await withRequestContext({ userId: viewer, requestId }, (db) => fetchThread(db, viewer, id.value), { readOnly: true });
    if (!detail) throw notFound("This post is not available.");
    return Response.json(postDetailSchema.parse(detail), {
      headers: personal ? noStore(requestId) : { "Cache-Control": CACHE.head, "X-Request-Id": requestId },
    });
  });
}

/** GET /api/v1/community/me: whether the guidelines were accepted, and who this person blocked. */
export function getCommunityMe(request: Request): Promise<Response> {
  return authedRoute(request, "community-me", async (requestId) => {
    const user = await authorize("community.post");
    const body = await withRequestContext({ userId: user.id, requestId }, (db) => fetchMe(db, user.id), { readOnly: true });
    return Response.json(communityMeSchema.parse(body), { headers: noStore(requestId) });
  });
}
