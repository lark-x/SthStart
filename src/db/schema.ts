// Drizzle schema for this app's database (SQLite: MonstarX-managed in previews, Cloudflare D1 in
// production). Define tables here and create them with a migration; the auth tables below are
// created for every app automatically.
export * from './auth-schema'

// Example:
// import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
// export const posts = sqliteTable('posts', {
//   id: text('id').primaryKey(),
//   title: text('title').notNull(),
//   createdAt: text('created_at').notNull(),
// })
