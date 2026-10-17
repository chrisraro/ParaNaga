// Masks identifiers in free text before it can leave the server for an AI service (spec 05 §5.8):
// emails, phone numbers and plate-like codes are replaced, and control or zero-width characters
// are dropped. Pure; the original text is stored unchanged for human reviewers.

const CONTROL_OR_ZERO_WIDTH = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060\uFEFF]/g;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// 7+ digits with optional separators, optional +63 prefix.
const PHONE = /(?:\+?\d[\d\s().-]{5,}\d)/g;
// Philippine plates: 3 letters + 3-4 digits (ABC 1234), or body numbers like AB-1234.
const PLATE = /\b[A-Z]{2,3}[\s-]?\d{3,4}\b/gi;

export function maskForAi(text: string): string {
  return text
    .replace(CONTROL_OR_ZERO_WIDTH, "")
    .replace(EMAIL, "[email]")
    .replace(PHONE, "[number]")
    .replace(PLATE, "[plate]")
    .trim();
}
