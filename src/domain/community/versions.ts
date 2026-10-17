// The edit-version rule (AC-11), mirrored by community.edit_post in migration 0017:
// an edit adds version n+1 as 'pending'. The published version stays live until the edit is
// published; an older unreviewed edit is superseded by the newer one.

export type VersionStatus = "pending" | "published" | "rejected" | "human_review" | "superseded";
export type PostVersion = { n: number; status: VersionStatus };
export type PostVersions = { versions: readonly PostVersion[]; publishedN: number | null };

const AWAITING: readonly VersionStatus[] = ["pending", "human_review"];

export function applyEdit(post: PostVersions, status: "pending" | "published" | "rejected"): PostVersions {
  const n = post.versions.reduce((max, v) => Math.max(max, v.n), 0) + 1;
  const versions = post.versions.map((v): PostVersion => {
    if (AWAITING.includes(v.status)) return { n: v.n, status: "superseded" };
    if (status === "published" && v.status === "published") return { n: v.n, status: "superseded" };
    return v;
  });
  versions.push({ n, status });
  return { versions, publishedN: status === "published" ? n : post.publishedN };
}

/** The version everyone sees, or null while nothing is published. */
export function liveVersion(post: PostVersions): PostVersion | null {
  return post.versions.find((v) => v.n === post.publishedN && v.status === "published") ?? null;
}

/** The newer version waiting for review, if any. */
export function awaitingEdit(post: PostVersions): PostVersion | null {
  const live = post.publishedN ?? 0;
  return post.versions.find((v) => AWAITING.includes(v.status) && v.n > live) ?? null;
}

/** What the author reads on their own post: the live version, or the latest if none is live. */
export function authorVersion(post: PostVersions): PostVersion | null {
  const live = liveVersion(post);
  if (live) return live;
  const sorted = [...post.versions].filter((v) => v.status !== "superseded").sort((a, b) => b.n - a.n);
  return sorted[0] ?? null;
}
