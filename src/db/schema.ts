import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { FeatureKind } from '@/lib/map/feature-kinds';
import type { AreaGeometry, FeatureGeometry } from '@/lib/map/geometry';

export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin' | 'treasurer' | 'wiki-editor';
export type FortnoxConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected';
export type FxSyncRunStatus = 'running' | 'succeeded' | 'failed';
export type FxSyncRunTrigger = 'manual' | 'nightly';
export type BoxProfile = 'admin' | 'contributor';
export type ProjectKind = 'event' | 'ongoing' | 'build' | 'purchase';
export type ProjectStatus = 'draft' | 'published' | 'cancelled' | 'closed' | 'archived';
export type ProjectVisibility = 'members' | 'public';
export type ProjectMemberRole = 'lead' | 'cocreator';
export type SignupStatus = 'going' | 'waitlist' | 'cancelled';
export type AnnualBudgetStatus = 'draft' | 'approved' | 'superseded';
export type BudgetLineKind = 'cost' | 'income' | 'allocation'; // allocation: a plan for the year's surplus (loan repayment, reserves, ...) — not a cost or income line, excluded from the Result computation

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
    role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin', 'treasurer', 'wiki-editor'] }).$type<Role>().notNull(),
    // Null for the one-time ADMIN_EMAILS bootstrap grant and the migration backfill, neither of which has a human granter.
    grantedByUserId: text('granted_by_user_id').references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export type RoleRequestStatus = 'pending' | 'approved' | 'denied';

export const roleRequest = pgTable('role_request', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin', 'treasurer', 'wiki-editor'] }).$type<Role>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).$type<RoleRequestStatus>().notNull().default('pending'),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
  decidedByUserId: text('decided_by_user_id').references(() => user.id),
  decidedAt: timestamp('decided_at'),
});

export type RoleRequest = typeof roleRequest.$inferSelect;

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
  projectGroupId: text('project_group_id').references((): AnyPgColumn => projectGroup.id),
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
  // Outline on the map: GeoJSON Polygon/MultiPolygon in WGS84 ([lon, lat]). Null = not on the map.
  geometry: jsonb('geometry').$type<AreaGeometry>(),
});

// Things on the map that aren't bookable areas: places (water, toilets, barns), borders, paths,
// sound zones, … Kinds, their layer and shape family are defined in src/lib/map/feature-kinds.ts.
export const mapFeature = pgTable('map_feature', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<FeatureKind>().notNull(),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  // GeoJSON geometry in WGS84 ([lon, lat]).
  geometry: jsonb('geometry').$type<FeatureGeometry>().notNull(),
  // Kind-specific extras, e.g. a sound zone's class and colour.
  properties: jsonb('properties').$type<Record<string, string | number | boolean>>().notNull().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [index('map_feature_kind_idx').on(t.kind)]);

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

/** One Fortnox import. The partial unique index is the lock: only one run can be 'running'. */
export const fxSyncRun = pgTable('fx_sync_run', {
  id: text('id').primaryKey(),
  trigger: text('trigger').$type<FxSyncRunTrigger>().notNull(),
  status: text('status').$type<FxSyncRunStatus>().notNull().default('running'),
  error: text('error'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  finishedAt: timestamp('finished_at'),
}, (t) => [uniqueIndex('fx_sync_run_one_running').on(t.status).where(sql`${t.status} = 'running'`)]);

export const projectGroup = pgTable('project_group', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  costCentreCode: text('cost_centre_code').unique().references(() => fxCostCentre.code),
  parentId: text('parent_id').references((): AnyPgColumn => projectGroup.id),
});

export const annualBudget = pgTable('annual_budget', {
  id: text('id').primaryKey(),
  fiscalYear: integer('fiscal_year').notNull(), // assumed calendar year — see the design doc's open question
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'approved', 'superseded'] }).$type<AnnualBudgetStatus>().notNull().default('draft'),
  approvedByUserId: text('approved_by_user_id').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('annual_budget_year_version_key').on(t.fiscalYear, t.version)]);

export const budgetAmount = pgTable('budget_amount', {
  id: text('id').primaryKey(),
  annualBudgetId: text('annual_budget_id').notNull().references(() => annualBudget.id, { onDelete: 'cascade' }),
  description: text('description').notNull().default(''), // what this line is, e.g. "Electricity", "Rainy Day Fund" — required at the form layer, not the DB
  projectGroupId: text('project_group_id').references(() => projectGroup.id), // nullable: an allocation line, or any line nobody's grouped yet, has none
  projectId: text('project_id').references(() => project.id),
  kind: text('kind', { enum: ['cost', 'income', 'allocation'] }).$type<BudgetLineKind>().notNull(),
  month: integer('month'), // 1-12, null = whole-year line
  amountSek: integer('amount_sek').notNull(), // öre, despite the name — platform-wide convention
  accountFrom: integer('account_from'),
  accountTo: integer('account_to'),
  createdAt: timestamp('created_at').notNull().defaultNow(), // stable list order — an edit must not change a row's position
});

export type TaskStatus = 'backlog' | 'doing' | 'done';

export const task = pgTable('task', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  status: text('status', { enum: ['backlog', 'doing', 'done'] }).$type<TaskStatus>().notNull().default('backlog'),
  assigneeUserId: text('assignee_user_id').references(() => user.id),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------
// Wiki. Design: docs/superpowers/specs/2026-11-02-wiki-design.md

export type WikiPageStatus = 'published' | 'deleted';

export const wikiPage = pgTable('wiki_page', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  content: jsonb('content').notNull(),
  searchText: text('search_text').notNull().default(''),
  parentId: text('parent_id').references((): AnyPgColumn => wikiPage.id),
  position: integer('position').notNull().default(0),
  status: text('status', { enum: ['published', 'deleted'] }).$type<WikiPageStatus>().notNull().default('published'),
  version: integer('version').notNull().default(1),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const wikiPageRevision = pgTable('wiki_page_revision', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => wikiPage.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: jsonb('content').notNull(),
  editedByUserId: text('edited_by_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const wikiPageComment = pgTable('wiki_page_comment', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => wikiPage.id, { onDelete: 'cascade' }),
  authorUserId: text('author_user_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type WikiPage = typeof wikiPage.$inferSelect;
export type WikiPageRevision = typeof wikiPageRevision.$inferSelect;
export type WikiPageComment = typeof wikiPageComment.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Utlägg (member outlays): receipts, approval, Fortnox booking and bank-file payouts.
// Design: docs/superpowers/specs/2026-11-03-expenses-bank-file-design.md

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

export type BankAccountKind = 'iban' | 'se';
export type ExpenseStatus = 'submitted' | 'approved' | 'rejected' | 'paid';
export type PaymentBatchStatus = 'exported' | 'paid' | 'cancelled';

// A member's payout account. The account numbers are only ever stored encrypted
// (AES-256-GCM, key BANK_DATA_KEY, see src/lib/expenses/bank-crypto.ts); `last4` is for display.
export const memberBankAccount = pgTable('member_bank_account', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['iban', 'se'] }).$type<BankAccountKind>().notNull(),
  holderName: text('holder_name').notNull(),
  encrypted: text('encrypted').notNull(),
  last4: text('last4').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
});

export const expense = pgTable('expense', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull().unique(), // short human id, e.g. "U-7F3K2Q"; also on the voucher and the payment
  userId: text('user_id').notNull().references(() => user.id), // no cascade: bookkeeping records outlive accounts
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  merchant: text('merchant').notNull().default(''),
  purchaseDate: text('purchase_date').notNull(), // YYYY-MM-DD
  totalOre: integer('total_ore').notNull(),
  vatOre: integer('vat_ore').notNull().default(0),
  note: text('note').notNull().default(''),
  status: text('status', { enum: ['submitted', 'approved', 'rejected', 'paid'] }).$type<ExpenseStatus>().notNull().default('submitted'),
  ocrSuggestion: jsonb('ocr_suggestion'), // what the receipt reader suggested, kept for comparison
  decidedByUserId: text('decided_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at'),
  rejectionReason: text('rejection_reason'),
  // Booking, set by the treasurer at approval.
  costAccount: integer('cost_account'),
  costCentreCode: text('cost_centre_code'),
  fxProjectCode: text('fx_project_code'),
  bookVat: boolean('book_vat').notNull().default(true),
  voucherYear: integer('voucher_year'), // Fortnox financial year id
  voucherSeries: text('voucher_series'),
  voucherNumber: integer('voucher_number'),
  bookedAt: timestamp('booked_at'),
  bookingError: text('booking_error'),
  paymentBatchId: text('payment_batch_id').references((): AnyPgColumn => paymentBatch.id, { onDelete: 'set null' }),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('expense_user_idx').on(t.userId), index('expense_status_idx').on(t.status)]);

export const expenseReceipt = pgTable('expense_receipt', {
  id: text('id').primaryKey(),
  expenseId: text('expense_id').notNull().references(() => expense.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  fortnoxFileId: text('fortnox_file_id'), // set once uploaded to the Fortnox inbox
  connectedAt: timestamp('connected_at'), // set once attached to the expense's voucher
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('expense_receipt_expense_idx').on(t.expenseId)]);

// One pain.001 file sent to the bank. The XML holds full account numbers, so it is stored encrypted.
export const paymentBatch = pgTable('payment_batch', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull().unique(), // e.g. "UB-20261103-1"; the file's message id
  status: text('status', { enum: ['exported', 'paid', 'cancelled'] }).$type<PaymentBatchStatus>().notNull().default('exported'),
  executionDate: text('execution_date').notNull(), // YYYY-MM-DD requested of the bank
  totalOre: integer('total_ore').notNull(),
  count: integer('count').notNull(),
  fileEncrypted: text('file_encrypted').notNull(),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  paidAt: text('paid_at'), // YYYY-MM-DD the bank paid, as confirmed by the treasurer
  decidedByUserId: text('decided_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  voucherYear: integer('voucher_year'),
  voucherSeries: text('voucher_series'),
  voucherNumber: integer('voucher_number'),
  bookingError: text('booking_error'),
});

// Single row ('default'): who pays (the association's own account) and how outlays are booked.
export const expenseSettings = pgTable('expense_settings', {
  id: text('id').primaryKey().default('default'),
  debtorName: text('debtor_name').notNull().default(''),
  debtorOrgNumber: text('debtor_org_number').notNull().default(''),
  debtorIban: text('debtor_iban').notNull().default(''),
  debtorBic: text('debtor_bic').notNull().default(''),
  bankCustomerId: text('bank_customer_id').notNull().default(''), // agreement id some banks require in the file
  bankLedgerAccount: integer('bank_ledger_account').notNull().default(1930),
  liabilityAccount: integer('liability_account').notNull().default(2890),
  vatAccount: integer('vat_account').notNull().default(2640),
  defaultCostAccount: integer('default_cost_account').notNull().default(6990),
  outlaySeries: text('outlay_series').notNull().default('U'),
  payoutSeries: text('payout_series').notNull().default('UB'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
});

export type Box = typeof boxes.$inferSelect;
export type User = typeof user.$inferSelect;
export type UserRole = typeof userRole.$inferSelect;
export type RenewalMessageSetting = typeof renewalMessageSetting.$inferSelect;
export type Project = typeof project.$inferSelect;
export type ProjectMember = typeof projectMember.$inferSelect;
export type EventDetails = typeof eventDetails.$inferSelect;
export type Area = typeof area.$inferSelect;
export type MapFeature = typeof mapFeature.$inferSelect;
export type EventArea = typeof eventArea.$inferSelect;
export type EventSignup = typeof eventSignup.$inferSelect;
export type DecisionLog = typeof decisionLog.$inferSelect;
export type ProjectGroup = typeof projectGroup.$inferSelect;
export type AnnualBudget = typeof annualBudget.$inferSelect;
export type BudgetAmount = typeof budgetAmount.$inferSelect;
export type Task = typeof task.$inferSelect;
export type MemberBankAccount = typeof memberBankAccount.$inferSelect;
export type Expense = typeof expense.$inferSelect;
export type ExpenseReceipt = typeof expenseReceipt.$inferSelect;
export type PaymentBatch = typeof paymentBatch.$inferSelect;
export type ExpenseSettings = typeof expenseSettings.$inferSelect;
