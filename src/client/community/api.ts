"use client";

// Browser side of the community hub. Nothing is stored on the phone: every call goes to
// /api/v1/community/*. Writes need an account; reading works as a guest.

import type { z } from "zod";
import {
  appealResponseSchema,
  blockResponseSchema,
  communityMeSchema,
  feedResponseSchema,
  okResponseSchema,
  postDetailSchema,
  submitCommentResponseSchema,
  submitPostResponseSchema,
  toggleResponseSchema,
  type AppealInput,
  type CommunityMe,
  type CreateCommentInput,
  type CreatePostInput,
  type EditPostInput,
  type FeedResponse,
  type FeedScope,
  type PostDetail,
  type ReportReason,
  type SubmitCommentResponse,
  type SubmitPostResponse,
  type TargetType,
  type ToggleResponse,
} from "@/domain/community/schemas";
import type { CommunityTopic } from "@/domain/community/topics";
import { en } from "@/i18n/dict";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "signed_out" | "rate_limited" | "invalid" | "not_found" | "conflict" | "failed"; message: string };

const JSON_HEADERS = { "content-type": "application/json" };
// English messages from the dictionary; screens show them with translated(message, en.community.api, t.community.api).
const M = en.community.api;
const FAILED = M.failed;

async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  init: RequestInit & { json?: unknown } = {},
): Promise<ApiResult<z.output<S>>> {
  const { json, ...rest } = init;
  try {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      ...(json !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(json) } : {}),
    });
    if (res.status === 401) return { ok: false, reason: "signed_out", message: M.signedOut };
    if (res.status === 429) return { ok: false, reason: "rate_limited", message: M.rateLimited };
    if (res.status === 404) return { ok: false, reason: "not_found", message: M.notFound };
    if (res.status === 409) return { ok: false, reason: "conflict", message: FAILED };
    if (res.status === 400 || res.status === 403) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, reason: "invalid", message: data?.error?.message ?? M.invalid };
    }
    if (!res.ok) return { ok: false, reason: "failed", message: FAILED };
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, reason: "failed", message: FAILED };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, reason: "failed", message: FAILED };
  }
}

export type FeedParams = { topic?: CommunityTopic | null; q?: string; tag?: string; scope?: FeedScope; cursor?: number | null };

/** `signedIn` asks for the personal view (own flags, blocks); guests get the shared, cacheable one. */
export function fetchFeed(params: FeedParams, signedIn: boolean): Promise<ApiResult<FeedResponse>> {
  const qs = new URLSearchParams();
  if (params.topic) qs.set("topic", params.topic);
  if (params.q) qs.set("q", params.q);
  if (params.tag) qs.set("tag", params.tag);
  if (params.scope && params.scope !== "all") qs.set("scope", params.scope);
  if (params.cursor) qs.set("cursor", String(params.cursor));
  if (signedIn) qs.set("me", "1");
  const suffix = qs.size > 0 ? `?${qs}` : "";
  return request(`/api/v1/community/posts${suffix}`, feedResponseSchema);
}

export function fetchPost(id: string, signedIn: boolean): Promise<ApiResult<PostDetail>> {
  return request(`/api/v1/community/posts/${id}${signedIn ? "?me=1" : ""}`, postDetailSchema);
}

export function fetchCommunityMe(): Promise<ApiResult<CommunityMe>> {
  return request("/api/v1/community/me", communityMeSchema);
}

export function submitPost(input: CreatePostInput): Promise<ApiResult<SubmitPostResponse>> {
  return request("/api/v1/community/posts", submitPostResponseSchema, { method: "POST", json: input });
}

export function submitEdit(id: string, input: EditPostInput): Promise<ApiResult<SubmitPostResponse>> {
  return request(`/api/v1/community/posts/${id}`, submitPostResponseSchema, { method: "PATCH", json: input });
}

export function removePost(id: string) {
  return request(`/api/v1/community/posts/${id}`, okResponseSchema, { method: "DELETE" });
}

export function submitComment(postId: string, input: CreateCommentInput): Promise<ApiResult<SubmitCommentResponse>> {
  return request(`/api/v1/community/posts/${postId}/comments`, submitCommentResponseSchema, { method: "POST", json: input });
}

export function removeComment(id: string) {
  return request(`/api/v1/community/comments/${id}`, okResponseSchema, { method: "DELETE" });
}

export function toggleHelpful(targetType: TargetType, targetId: string): Promise<ApiResult<ToggleResponse>> {
  return request("/api/v1/community/reactions", toggleResponseSchema, { method: "POST", json: { targetType, targetId } });
}

export function toggleSaved(postId: string): Promise<ApiResult<ToggleResponse>> {
  return request("/api/v1/community/bookmarks", toggleResponseSchema, { method: "POST", json: { postId } });
}

export function blockPerson(targetType: TargetType, targetId: string) {
  return request("/api/v1/community/blocks", blockResponseSchema, { method: "POST", json: { targetType, targetId } });
}

export function unblockPerson(id: string) {
  return request(`/api/v1/community/blocks/${id}`, okResponseSchema, { method: "DELETE" });
}

export function reportPost(targetType: TargetType, targetId: string, reason: ReportReason, note?: string) {
  return request("/api/v1/community/reports", okResponseSchema, {
    method: "POST",
    json: { targetType, targetId, reason, ...(note ? { note } : {}) },
  });
}

/** The author asks for another review of a decision not to publish (N6); "conflict" = already asked. */
export function submitAppeal(input: AppealInput) {
  return request("/api/v1/community/appeals", appealResponseSchema, { method: "POST", json: input });
}
