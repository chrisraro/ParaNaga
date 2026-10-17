import { CACHE, publicGet } from "@/server/api/http";
import { getCurrentUser } from "@/server/auth/session";
import { authSessionResponseSchema } from "@/domain/auth/schemas";

// Returns current commuter session and effective roles.
// Cached as no-store so client fetches immediately reflect login / logout state.
export function GET(request: Request) {
  return publicGet(request, "me", authSessionResponseSchema, async () => {
    const user = await getCurrentUser();
    if (!user) {
      return { body: { user: null }, cacheControl: CACHE.none };
    }
    return {
      body: {
        user: {
          id: user.id,
          name: user.name || "Commuter",
          roles: user.roles,
        },
      },
      cacheControl: CACHE.none,
    };
  });
}
