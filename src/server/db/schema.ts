import { boolean, integer, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Drizzle mirrors of tables created by hand-written SQL in db/migrations.
// The SQL files are the source of truth; keep these in sync.

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

export const preference = core.table("preference", {
  userId: text("user_id").primaryKey(),
  fareCategory: text("fare_category").notNull(),
  maxWalkM: integer("max_walk_m").notNull(),
  avoidStairs: boolean("avoid_stairs").notNull(),
  highContrast: boolean("high_contrast").notNull(),
  reducedMotion: boolean("reduced_motion").notNull(),
  lowData: boolean("low_data").notNull(),
  historyEnabled: boolean("history_enabled").notNull(),
});
