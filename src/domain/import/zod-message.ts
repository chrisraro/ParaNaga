import type { z } from "zod";

/** One-line description of the first Zod issue: "<where>: invalid at <path|root>: <message>". */
export function zodMessage(where: string, error: z.ZodError): string {
  const first = error.issues[0];
  const at = first && first.path.length > 0 ? first.path.join(".") : "root";
  return `${where}: invalid at ${at}: ${first?.message ?? "unknown error"}`;
}
