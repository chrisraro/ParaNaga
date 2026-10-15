import "server-only";

const SAFE_REQUEST_ID = /^[A-Za-z0-9:_-]{1,64}$/;

/** Client-supplied ids end up in logs and audit rows, so only a safe shape is accepted. */
export function safeRequestId(candidate: string | null | undefined): string {
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}
