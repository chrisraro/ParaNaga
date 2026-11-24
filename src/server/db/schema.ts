import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Only the tables the app queries through Drizzle (src/server/auth/session.ts). Everything else is
// raw SQL; db/migrations is the source of truth for every table.

export const core = pgSchema("core");

export const userRole = core.table("user_role", {
  id: uuid("id").primaryKey(),
  userId: text("user_id").notNull(),
  roleCode: text("role_code").notNull(),
  grantedBy: text("granted_by"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  reason: text("reason").notNull(),
});

export const profile = core.table("profile", {
  userId: text("user_id").primaryKey(),
  displayName: text("display_name").notNull(),
  locale: text("locale").notNull(),
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
