type AuthClient = ReturnType<typeof import("@neondatabase/auth/next").createAuthClient>;

let clientInstance: Promise<AuthClient> | null = null;

/** Loads the auth library on first use, so commuters who never sign in do not download it. */
export async function getAuthClient(): Promise<AuthClient | null> {
  if (typeof window === "undefined") return null;
  // A failed chunk download must not stick: clear it so the next attempt retries.
  clientInstance ??= import("@neondatabase/auth/next").then(
    (m) => m.createAuthClient(),
    (error: unknown) => {
      clientInstance = null;
      throw error;
    },
  );
  return clientInstance;
}
