import "server-only";
import { z } from "zod";

// Parsed once at first use. Missing optional providers degrade to honest
// "unavailable" states; a missing Jev key keeps submissions pending (spec §3.14).

const DATED_JEV_BUILD = /^typesafe\/jev-\d+\.\d+-\d{8}$/;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const flag = z
  .preprocess(emptyToUndefined, z.enum(["true", "false"]).optional())
  .transform((v) => v === "true");

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Strict checks key off the real deployment, not NODE_ENV (`next start` is always "production").
    VERCEL_ENV: z.preprocess(emptyToUndefined, z.enum(["production", "preview", "development"]).optional()),
    APP_ENV: z.preprocess(emptyToUndefined, z.enum(["production", "staging", "development"]).optional()),
    // Runtime connection as the restricted paranaga_app role (pooled endpoint).
    // Deliberately not DATABASE_URL: the Vercel Neon integration manages that one and
    // sets it to the owner role, which would bypass row-level security.
    PARANAGA_DATABASE_URL: optionalUrl,
    NEON_AUTH_BASE_URL: optionalUrl,
    NEON_AUTH_COOKIE_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_ACCESS_KEY_ID: optionalString,
    STORAGE_SECRET_ACCESS_KEY: optionalString,
    STORAGE_BUCKET_PUBLIC: z.string().default("public-media"),
    STORAGE_BUCKET_QUARANTINE: z.string().default("quarantine"),
    STORAGE_BUCKET_EVIDENCE: z.string().default("evidence-private"),
    OPENROUTER_API_KEY: optionalString,
    JEV_MODEL_ID: z.string().default("typesafe/jev-1.13"),
    JEV_DECISIONS_URL: z.url().default("https://openrouter.ai/api/alpha/decisions"),
    JEV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    JEV_POLICY_VERSION: z.string().default("paranaga-community-v1"),
    JEV_DAILY_BUDGET_REQUESTS: z.coerce.number().int().min(0).default(5000),
    AUTO_PUBLISH_ENABLED: flag,
    JEV_COMPLAINTS_ENABLED: flag,
    CRON_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  })
  .superRefine((env, ctx) => {
    if (env.VERCEL_ENV !== "production" && env.APP_ENV !== "production") return;
    if (!DATED_JEV_BUILD.test(env.JEV_MODEL_ID)) {
      ctx.addIssue({
        code: "custom",
        path: ["JEV_MODEL_ID"],
        message:
          "Production requires a dated Jev build id such as typesafe/jev-1.13-20260917; aliases (jev-latest, jev-router, typesafe/jev-1.13) are refused.",
      });
    }
    for (const key of ["PARANAGA_DATABASE_URL", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET", "CRON_SECRET"] as const) {
      if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required in production.` });
    }
    if (env.PARANAGA_DATABASE_URL && new URL(env.PARANAGA_DATABASE_URL).username !== "paranaga_app") {
      ctx.addIssue({
        code: "custom",
        path: ["PARANAGA_DATABASE_URL"],
        message: "PARANAGA_DATABASE_URL must connect as paranaga_app (the owner role bypasses row-level security).",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    // Name the variables only; never echo values.
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server environment:\n${problems}`);
  }
  return parsed.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = serverEnv()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${String(key)} is not configured.`);
  }
  return value as NonNullable<ServerEnv[K]>;
}
