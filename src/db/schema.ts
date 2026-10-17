import { pgTable, text, timestamp, varchar, json } from 'drizzle-orm/pg-core';

export const submissions = pgTable('submissions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  city: varchar('city', { length: 255 }).notNull(),
  area: varchar('area', { length: 255 }).notNull(), // district
  name: varchar('name', { length: 255 }).notNull(),
  creatorNickname: varchar('creator_nickname', { length: 255 }).notNull(),
  path: json('path').$type<Array<{ lng: number; lat: number }>>().default([]),
  via_stops: json('via_stops').$type<Array<{ name: string; location: { lng: number; lat: number } }>>().default([]),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  dataSourceText: text('data_source_text'),
  dataSourceImage: text('data_source_image'),
  rejectReason: text('reject_reason'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
