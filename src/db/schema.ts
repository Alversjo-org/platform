import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export type Role = 'member' | 'admin';
export type BoxProfile = 'admin' | 'contributor';

// BetterAuth core tables. Field names (TS keys) must match BetterAuth's model
// fields; column names are ours.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['member', 'admin'] }).$type<Role>().notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

// Platform tables
export const boxes = pgTable('boxes', {
  id: text('id').primaryKey(), // 12 lowercase hex chars; also the hostname label
  name: text('name').notNull(),
  profile: text('profile', { enum: ['admin', 'contributor'] }).$type<BoxProfile>().notNull(),
  flyMachineId: text('fly_machine_id'),
  flyVolumeId: text('fly_volume_id'),
  status: text('status').notNull().default('creating'), // last known Fly state
  protected: boolean('protected').notNull().default(false),
  jwtSecret: text('jwt_secret').notNull(),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const boxAccess = pgTable(
  'box_access',
  {
    boxId: text('box_id').notNull().references(() => boxes.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    grantedByUserId: text('granted_by_user_id').notNull().references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.boxId, t.userId] })],
);

export type Box = typeof boxes.$inferSelect;
export type User = typeof user.$inferSelect;
