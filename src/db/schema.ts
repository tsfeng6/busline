import { pgTable, text, timestamp, varchar, json } from 'drizzle-orm/pg-core';

export const submissions = pgTable('submissions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  city: varchar('city', { length: 255 }).notNull(),
  area: varchar('area', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  creatorNickname: varchar('creator_nickname', { length: 255 }).notNull(),
  path: json('path').default([]),
  via_stops: json('via_stops').default([]),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // 'pending', 'approved', 'rejected'
  timestamp: timestamp('timestamp').notNull().defaultNow(),
});

