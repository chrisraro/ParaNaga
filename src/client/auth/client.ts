import { createAuthClient } from "@neondatabase/auth/next";

let clientInstance: ReturnType<typeof createAuthClient> | null = null;

export function getAuthClient() {
  if (typeof window === "undefined") return null;
  if (!clientInstance) {
    clientInstance = createAuthClient();
  }
  return clientInstance;
}
