// Pure comment-thread rules: at most two levels (a reply to a reply is not allowed), and content
// by a blocked author is hidden from the blocker together with everything underneath it.

export const MAX_COMMENT_DEPTH = 2;

/** The depth a reply gets, or null when the parent is already at the last level. */
export function replyDepth(parentDepth: number | null): 1 | 2 | null {
  if (parentDepth === null) return 1;
  return parentDepth < MAX_COMMENT_DEPTH ? 2 : null;
}

export type ThreadRow = {
  id: string;
  parentId: string | null;
  depth: number;
  authorId: string;
};

export type ThreadNode<T extends ThreadRow> = T & { replies: ThreadNode<T>[] };

/** Rows whose author the viewer blocked, plus every reply below them. Own rows always stay. */
export function hideBlocked<T extends ThreadRow>(rows: readonly T[], blocked: ReadonlySet<string>, viewerId: string | null): T[] {
  if (blocked.size === 0) return [...rows];
  const hidden = new Set<string>();
  // Iterate to a fixed point so the order of the rows does not matter.
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (hidden.has(r.id)) continue;
      const own = viewerId !== null && r.authorId === viewerId;
      if ((!own && blocked.has(r.authorId)) || (r.parentId !== null && hidden.has(r.parentId))) {
        hidden.add(r.id);
        changed = true;
      }
    }
  }
  return rows.filter((r) => !hidden.has(r.id));
}

/**
 * Builds the tree in the order given. A row whose parent is missing (not published, deleted or
 * hidden) is dropped with its replies, and anything deeper than two levels is dropped too.
 */
export function nestComments<T extends ThreadRow>(rows: readonly T[]): ThreadNode<T>[] {
  const nodes = new Map<string, ThreadNode<T>>();
  for (const r of rows) nodes.set(r.id, { ...r, replies: [] });
  const roots: ThreadNode<T>[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id);
    if (!node) continue;
    if (r.parentId === null) {
      if (r.depth === 1) roots.push(node);
      continue;
    }
    const parent = nodes.get(r.parentId);
    if (parent && parent.depth === 1 && r.depth === 2) parent.replies.push(node);
  }
  return roots;
}
