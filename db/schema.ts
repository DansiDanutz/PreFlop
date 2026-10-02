import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  check,
  index,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    balance: integer("balance").notNull(),
    version: integer("version").notNull(),
    favorites: text("favorites").notNull(),
    favoriteTables: text("favorite_tables").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [
    check("balance_nonnegative", sql`${t.balance} >= 0`),
    check("version_nonnegative", sql`${t.version} >= 0`),
  ],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: text("id").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id),
    tableId: text("table_id").notNull(),
    selectionId: text("selection_id").notNull(),
    stake: integer("stake").notNull(),
    oddsCenti: integer("odds_centi").notNull(),
    payout: integer("payout").notNull(),
    won: integer("won").notNull(),
    cards: text("cards").notNull(),
    balanceBefore: integer("balance_before").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.id] }),
    index("rounds_profile_created").on(t.profileId, t.createdAt),
    check("stake_bounds", sql`${t.stake} >= 10 AND ${t.stake} <= 1000`),
    check("payout_nonnegative", sql`${t.payout} >= 0`),
    check("odds_positive", sql`${t.oddsCenti} >= 100`),
    check("won_boolean", sql`${t.won} IN (0,1)`),
    check(
      "round_balance_exact",
      sql`${t.balanceAfter} = ${t.balanceBefore} - ${t.stake} + ${t.payout} AND ${t.balanceBefore} >= ${t.stake} AND ${t.balanceAfter} >= 0`,
    ),
  ],
);
