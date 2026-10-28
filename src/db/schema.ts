import { boolean, index, integer, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';

export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin' | 'treasurer';
export type FortnoxConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected';
export type BoxProfile = 'admin' | 'contributor';
export type ProjectKind = 'event' | 'ongoing' | 'build' | 'purchase';
export type ProjectStatus = 'draft' | 'published' | 'cancelled' | 'closed' | 'archived';
export type ProjectVisibility = 'members' | 'public';
export type ProjectMemberRole = 'lead' | 'cocreator';
export type SignupStatus = 'going' | 'waitlist' | 'cancelled';

// BetterAuth core tables. Field names (TS keys) must match BetterAuth's model
// fields; column names are ours.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  nickname: text('nickname'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  phoneNumber: text('phone_number'),
  discordHandle: text('discord_handle'),
  isActiveMember: boolean('is_active_member').notNull().default(false),
  membershipExpiresAt: timestamp('membership_expires_at'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  lastContactedAt: timestamp('last_contacted_at'),
  contactNotes: text('contact_notes'),
  canCreateEvents: boolean('can_create_events').notNull().default(true),
  icalToken: text('ical_token').unique(),
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

export const userRole = pgTable(
  'user_role',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin'] }).$type<Role>().notNull(),
    // Null for the one-time ADMIN_EMAILS bootstrap grant and the migration backfill, neither of which has a human granter.
    grantedByUserId: text('granted_by_user_id').references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const renewalMessageSetting = pgTable('renewal_message_setting', {
  id: text('id').primaryKey().default('default'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id),
});

export const project = pgTable('project', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  kind: text('kind', { enum: ['event', 'ongoing', 'build', 'purchase'] }).$type<ProjectKind>().notNull(),
  status: text('status', { enum: ['draft', 'published', 'cancelled', 'closed', 'archived'] }).$type<ProjectStatus>().notNull().default('draft'),
  visibility: text('visibility', { enum: ['members', 'public'] }).$type<ProjectVisibility>().notNull().default('members'),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id),
  publishedAt: timestamp('published_at'), // set once, on draft->published; drives the signup-window default (spec §5: "open from publishing until the start")
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const projectMember = pgTable('project_member', {
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['lead', 'cocreator'] }).$type<ProjectMemberRole>().notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

export const eventDetails = pgTable('event_details', {
  projectId: text('project_id').primaryKey().references(() => project.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  hasCapacityLimit: boolean('has_capacity_limit').notNull(),
  capacity: integer('capacity'), // NULL iff !hasCapacityLimit
  signupOpensAt: timestamp('signup_opens_at'),
  signupClosesAt: timestamp('signup_closes_at'), // null = until startsAt
  priceSek: integer('price_sek').notNull().default(0), // whole öre; informational only, never booked
  priceNote: text('price_note'),
  contactNote: text('contact_note'),
  showSignupsToParticipants: boolean('show_signups_to_participants').notNull().default(false),
});

export const area = pgTable('area', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  capacity: integer('capacity'), // advisory only
  bookable: boolean('bookable').notNull().default(true),
});

export const areaGridCell = pgTable('area_grid_cell', {
  areaId: text('area_id').notNull().references(() => area.id, { onDelete: 'cascade' }),
  col: integer('col').notNull(),
  row: integer('row').notNull(),
}, (t) => [primaryKey({ columns: [t.areaId, t.col, t.row] })]);

export const eventArea = pgTable('event_area', {
  id: text('id').primaryKey(),
  eventProjectId: text('event_project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  areaId: text('area_id').notNull().references(() => area.id),
  from: timestamp('from').notNull(),
  to: timestamp('to').notNull(),
  setupNote: text('setup_note'),
}, (t) => [index('event_area_area_time_idx').on(t.areaId, t.from, t.to)]);

export const eventSignup = pgTable('event_signup', {
  eventProjectId: text('event_project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['going', 'waitlist', 'cancelled'] }).$type<SignupStatus>().notNull(),
  seats: integer('seats').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventProjectId, t.userId] })]);

export const decisionLog = pgTable('decision_log', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => user.id),
  action: text('action').notNull(),
  diff: text('diff').notNull(), // JSON string
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const fortnoxConnection = pgTable('fortnox_connection', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['connected', 'needs_reauth', 'disconnected'] }).$type<FortnoxConnectionStatus>().notNull().default('disconnected'),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  connectedByUserId: text('connected_by_user_id').references(() => user.id),
  connectedAt: timestamp('connected_at'),
  lastRefreshedAt: timestamp('last_refreshed_at'),
  lastRefreshError: text('last_refresh_error'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const fxFinancialYear = pgTable('fx_financial_year', {
  id: text('id').primaryKey(),
  fortnoxId: integer('fortnox_id').notNull().unique(),
  fromDate: text('from_date').notNull(), // ISO date (YYYY-MM-DD), stored as text like Fortnox returns it
  toDate: text('to_date').notNull(),
  lockedUntilDate: text('locked_until_date'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxAccount = pgTable('fx_account', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique('fx_account_year_number_key').on(t.year, t.number)]);

export const fxCostCentre = pgTable('fx_cost_centre', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxProject = pgTable('fx_project', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxVoucher = pgTable('fx_voucher', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  series: text('series').notNull(),
  number: integer('number').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull().default(''),
  referenceType: text('reference_type'),
  referenceNumber: text('reference_number'),
  comments: text('comments'),
  hasAttachment: boolean('has_attachment').notNull().default(false),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique('fx_voucher_key').on(t.year, t.series, t.number)]);

export const fxVoucherRow = pgTable('fx_voucher_row', {
  id: text('id').primaryKey(),
  voucherId: text('voucher_id').notNull().references(() => fxVoucher.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  account: integer('account').notNull(),
  debitSek: integer('debit_sek').notNull().default(0),
  creditSek: integer('credit_sek').notNull().default(0),
  costCentreCode: text('cost_centre_code').references(() => fxCostCentre.code),
  fxProjectCode: text('fx_project_code').references(() => fxProject.code),
  transactionInfo: text('transaction_info'),
  removed: boolean('removed').notNull().default(false),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique('fx_voucher_row_key').on(t.voucherId, t.rowIndex)]);

export const fxSyncState = pgTable('fx_sync_state', {
  topic: text('topic').primaryKey(),
  lastWebsocketOffset: text('last_websocket_offset'),
  lastFullSyncAt: timestamp('last_full_sync_at'),
});

export type Box = typeof boxes.$inferSelect;
export type User = typeof user.$inferSelect;
export type UserRole = typeof userRole.$inferSelect;
export type RenewalMessageSetting = typeof renewalMessageSetting.$inferSelect;
export type Project = typeof project.$inferSelect;
export type ProjectMember = typeof projectMember.$inferSelect;
export type EventDetails = typeof eventDetails.$inferSelect;
export type Area = typeof area.$inferSelect;
export type AreaGridCell = typeof areaGridCell.$inferSelect;
export type EventArea = typeof eventArea.$inferSelect;
export type EventSignup = typeof eventSignup.$inferSelect;
export type DecisionLog = typeof decisionLog.$inferSelect;
