# Alversjö platform: Fortnox data, classification and budget tracking

Oct 15, 2026 · @Viktor

## Summary

The platform can read everything booked in Fortnox, let members classify costs and attach receipts, and track spending against annual budgets. It cannot see bank transactions before they are booked: Fortnox's public API has no endpoint for them as of October 2026.

- **Read, don't write, by default.** The platform pulls vouchers, accounts, projects and cost centres from Fortnox, and keeps its own decisions (classification, budgets) in its own tables.
- **Write only where it's bookkeeping.** Receipts are attached to vouchers through the Fortnox inbox. Member outlays become vouchers. Project codes go back only as a batched reclassification, if at all.
- **Fast booking is the substitute for live bank data.** If the treasurer uses Fortnox's bank connection with booking rules, transactions become vouchers within days, and the platform picks them up within minutes of booking.

This companion document builds on the reference report *Alversjö platform: projects, events and co-budgeting reference*.

## Bank transactions before booking

Fortnox does store incoming bank transactions before they are booked, but only inside its own interface; no API scope, endpoint or change event exposes them.

### What Fortnox stores

- With a bank connection or Fortnox's open banking connection, transactions from connected accounts arrive in Fortnox under **Transaktioner**: a to-do list of unbooked items and a history ([Fortnox: Open banking](https://support.fortnox.se/produkthjalp/bankkopplingar/snabbare-koppling-till-din-bank)).
- **Bokföring från kontoutdrag** compares those transactions with the bookkeeping. From each one you can create a voucher, link it to an existing voucher, or comment. Booking rules can book recurring patterns automatically ([Fortnox: automatisk kontoavstämning](https://support.fortnox.se/produkthjalp/bokforing/bokforing-fran-kontoutdrag-automatisk-kontoavstamning)).
- Banks supported include Handelsbanken, SEB, Swedbank and Sparbankerna, Danske Bank, Nordea Business, Länsförsäkringar, Lunar and Sparbanken Syd. Consent is given with Mobile BankID and must be renewed every 180 days. Granting access is free.
- Currency accounts can't currently be reconciled in this view.

### What the API exposes

- **No transactions endpoint.** The scope list has nothing for bank transactions or statements; the nearest is `payment`, which covers customer and supplier invoice payments only ([scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes)).
- **No change event.** The WebSocket topics cover vouchers, supplier invoices, invoices, projects, cost centres and more, but not bank transactions ([WebSockets](https://www.fortnox.se/developer/guides-and-good-to-know/websockets)).
- **Others have asked for it.** A January 2025 forum thread asks for exactly this endpoint and reports a feature request filed with Fortnox; nothing shipped since that I could find ([invantive forum](https://forums.invantive.com/t/fortnox-api-missing-functionality-transactions-endpoint/5142)).

### Options

| Option | How it works | Delay | Effort | Notes |
| --- | --- | --- | --- | --- |
| Book fast in Fortnox, read vouchers | Treasurer books from Transaktioner, with booking rules for recurring items. The platform gets `voucher-created` events and fetches the voucher. | Hours to days, set by the treasurer's rhythm | Low | Recommended. One source of truth, no extra bank access. |
| Bank statement upload | Treasurer exports the bank's CSV or camt.053 file and uploads it to the platform, which matches lines to vouchers later | As often as someone uploads | Low | Good stopgap; manual |
| Open banking data provider (AIS) | A licensed provider such as Tink or Enable Banking reads the account and sends transactions to the platform | Near real time | Medium to high | Separate BankID consent every 90–180 days, a contract and personal-data handling. Worth it only if live visibility matters. |
| Wise's own API | For the Wise account only: transfer state webhooks | Real time for payouts | Low | Statements and balances are not readable by API for EEA businesses |
| Ask Fortnox | Ask through the developer or partner channel whether a transactions API is planned | Unknown | Low | Worth one email |

**Recommendation:** use fast booking in Fortnox now. Design the platform's tables so a pre-booking transaction source can be added later, keyed by date, amount and bank reference, without changing the rest.

## Data flow

[embedded content: bank to platform · what flows where]

The treasurer's booking step is the gate: once a transaction is a voucher, the platform sees it within minutes, and receipts and outlays flow back into Fortnox as files and vouchers.

## What can be pulled from Fortnox

Everything booked is readable: vouchers with their rows, accounts, projects, cost centres, supplier invoices and their payments, plus a full SIE export per year.

| Data | Endpoint (base `https://api.fortnox.se/3`) | Scope | Use on the platform |
| --- | --- | --- | --- |
| Financial years | `/financialyears`, `?date=` to find the one for a date | bookkeeping | Year IDs for every voucher call |
| Chart of accounts | `/accounts` per year | bookkeeping | Group actuals by account range in budgets |
| Vouchers + rows | `/vouchers?financialyear=`, `/vouchers/sublist/{series}`, `/vouchers/{series}/{number}?financialyear=` | bookkeeping | The actuals: every cost and income row |
| Voucher series | `/voucherseries` | bookkeeping | Create U and UB for outlays |
| Full year export | `/sie/4?financialyear=` (SIE 4) | bookkeeping | First import and yearly cross-check |
| Projects | `/projects` | project | Optional mirror of platform projects |
| Cost centres | `/costcenters` | costcenter | Funds and project groups |
| Supplier invoices | `/supplierinvoices` | supplierinvoice | Incoming invoices; editable until booked |
| Supplier invoice payments | `/supplierinvoicepayments` | payment | When an invoice was paid |
| Inbox and archive | `/inbox`, `/archive` | inbox, archive | Upload receipts |
| Attach files to vouchers | `/voucherfileconnections` | connectfile | Link a receipt to its voucher |
| Locked periods | `/settings/lockedperiod` | settings | Know which months can no longer take vouchers |

- **Change events:** WebSocket `wss://ws.fortnox.se/topics-v1`, topics `vouchers` (created, updated, deleted, with year, series and number), `supplier-invoices`, `projects`, `cost-centers`, `financial-years`. Events carry only IDs, may arrive more than once, and can be replayed for about two weeks.
- **Limits:** 300 requests per minute per client and tenant, enforced as 25 per 5 seconds. Vouchers can be created and read, not edited.
- **Auth:** a service account with client credentials: one admin consent, then a token per hour with no refresh token to rotate. Every scope gives both read and write, so keep the secret on the server.
- **No API for:** bank transactions (above) or Fortnox's own budget view. Budgets live in the platform.

Two details to confirm in the sandbox: the exact SIE endpoint path, and the scope page's mention of a voucher delete permission, which conflicts with the API reference showing create and read only.

> **2026-10-27 correction (see the budget-tracking-and-Fortnox-sync design doc, §2):** the "no refresh token to rotate" line above does not match Fortnox's current developer docs. The service-account flow (`account_type=service`) is still an OAuth2 authorization-code grant: a one-time admin consent produces a 1-hour access token **and** a 45-day refresh token, and the refresh token rotates (single-use — each refresh returns a new one, invalidating the old). That changes the storage design: tokens must live in a database row the running app can update, not in a static Fly secret. Kept here unedited for history; the design doc is the corrected source.

## Sync design

The platform keeps a read-only mirror of Fortnox in its own tables. Each voucher row is identified by year, series, number and row index, and is never edited locally.

| Table | Holds | Key |
| --- | --- | --- |
| `fx_financial_year` | Fortnox year ID, from and to dates, locked-until date | fortnox_id |
| `fx_account` | Account number, name, year, active | (year, number) |
| `fx_cost_centre`, `fx_project` | Code, name, active | code |
| `fx_voucher` | Year, series, number, date, description, reference type and number, comments, has_attachment, synced_at | (year, series, number) |
| `fx_voucher_row` | Row index, account, debit, credit, cost centre, project, transaction info, removed flag | (year, series, number, row) |
| `fx_supplier_invoice` | Given number, supplier, dates, total, VAT, booked flag, rows | given_number |
| `fx_sync_state` | Last WebSocket offset per topic, last full sync per year | topic |

### First import

1. Read financial years, accounts, cost centres and projects.
2. For each year in scope (this year and last), page through `/vouchers?financialyear=` and fetch each voucher with its rows. At a few thousand vouchers a year this takes minutes inside the rate limit.
3. Optionally cross-check totals per account against the SIE 4 file for the year.

### Ongoing sync

- A small worker process on Fly holds the WebSocket connection and stores events in a queue table.
- For each `voucher-created` or `voucher-updated` event, it fetches that voucher and upserts it. Duplicate events are harmless because the upsert is keyed.
- A nightly job re-reads the current month and the previous one, to catch anything missed and changes made with **Ändra** in Fortnox.
- After the worker has been down for more than two weeks, the WebSocket can no longer replay, so the nightly job falls back to a full re-read of the year.
- Every API call goes through one client with a token bucket (25 per 5 seconds) and backoff on HTTP 429.

Amounts are stored in öre as integers. Rows marked `removed` (struck in Fortnox) are kept but excluded from totals.

## Classification

Members assign each cost or income row to a project, and the platform keeps every assignment with who, when and why; Fortnox is not changed.

| Table | Holds |
| --- | --- |
| `classification` | voucher row key, project_id, amount_sek (a share of the row), decided_by, decided_at, reason, superseded_by. A row can be split across projects; the shares must sum to the row amount. |
| `classification_rule` | Suggestions: "supplier text contains *Biltema* and account 5460 → project Infrastructure". Rules suggest; a person confirms. |

### How it works

1. New cost rows (accounts 4000–7999) and income rows (3000–3999) land in an **Unclassified** list.
2. If the row already carries a Fortnox project or cost centre, the platform pre-fills the matching project or group.
3. Rules and past choices for the same supplier pre-fill a suggestion.
4. A project lead, group member or treasurer confirms, picks another project, or splits the amount.
5. A change later writes a new `classification` row that supersedes the old one. The history stays visible on the cost.

### Who may classify

- Project leads, within their own projects.
- Project group members, within their group.
- Treasurers, everywhere.
- Moving a cost between project groups, or into a project from a different fund, needs a treasurer.

### Pushing back to Fortnox (optional)

The Fortnox API cannot edit a booked voucher, so each push is a new reclassification voucher. If projects are wanted in Fortnox, post one batch voucher per month in a series such as **O**: for each changed row, credit the account with the old project and debit the same account with the new one. Account totals and VAT are unchanged. Posting into a locked period is impossible, so changes after a period closes land in the current period. Pushing is optional: the books are complete without it.

## Annual budgets and tracking

A budget is a frozen, versioned set of amounts per project group (and optionally per project) per month; tracking compares it with classified Fortnox actuals.

| Table | Holds |
| --- | --- |
| `annual_budget` | fiscal_year, version, status (`draft` / `approved` / `superseded`), approved_by, approved_at, note |
| `budget_amount` | annual_budget_id, project_group_id, project_id (optional), kind (`cost` / `income`), month (1–12, or null for the whole year), amount_sek, account range (optional, e.g. 5000–5999) |
| `forecast` | project_group_id, month, amount_sek, by, at: the group's current expectation for the rest of the year |

### What actual counts against which budget line

1. A classified row counts against its project, and through the project against its project group.
2. An unclassified row counts against the project group whose cost centre it carries in Fortnox.
3. A row with neither shows in a visible **Not yet placed** bucket, so totals still match the books.

The sum of all three always equals Fortnox's result for the period. That check runs nightly and shows a warning if it fails.

### Views

- **Year overview:** per project group: budget, actual to date, forecast, remaining, and a burn line by month.
- **Group page:** its projects, their allocations and actuals, the unclassified rows waiting for the group, and receipts missing.
- **Project page:** budget lines, allocation, actual costs with receipts, remaining.
- **Public page:** totals per group and per public project; never receipts, names or payout details.

Budget changes during the year create a new version. The original approved version stays for comparison, so the year-end report can show both "as approved" and "as revised".

## Receipts

Receipts enter in three ways, and all three end as a file connected to a Fortnox voucher, the legal archive. The platform keeps a working copy.

| Situation | Example | Flow |
| --- | --- | --- |
| A booked transaction lacks its receipt | A card payment at a hardware store, booked from the bank by the treasurer | The voucher shows in **Missing receipts** (no file connection). The member who paid uploads a photo. The platform converts it to JPG or PDF, uploads it to the Fortnox inbox, connects it to the voucher, and classifies the row at the same time. |
| A member paid with their own money | Food bought for a work weekend | Outlay claim against a funded project: receipts, then treasurer approval. Voucher in series U (cost + 2640 VAT, credit 2890), receipts connected. Wise batch payout, then voucher in series UB (debit 2890, credit the Wise account, fees to 6570). |
| A supplier sends an invoice | Timber delivery with a 30-day invoice | Registered in Fortnox's supplier invoices and left unbooked. The platform shows it for classification, sets project and cost centre on its rows through the API, then it is booked and paid in Fortnox. |

### Rules for the upload form

These come from Borderland's Dreamer Expense Manual and the bookkeeping law:

- Each receipt shows seller, date, what was bought, amount and how it was paid. AI extraction pre-fills these, and the uploader confirms them.
- Receipts in languages other than Swedish, Danish, Norwegian or English need a short translation.
- A Swish payment to a private seller needs a written receipt from the seller.
- No receipt, no payout. Nobody approves their own outlay.
- Reimburse exactly the receipt amount; mileage and fees are separate and reportable, so they stay out of this flow.

### Storage

- The original goes to Fortnox (the legal copy, kept for 7 years) and to the platform's own object storage with a SHA-256 hash, never overwritten.
- The platform has no object storage yet. Add an S3-compatible bucket, for example Tigris on Fly, with private access and signed URLs.
- Fortnox's inbox accepts PDF, TIF and JPG, so convert phone formats such as HEIC and PNG first.

## First steps

Build read-only first; the platform should show the books correctly before anyone writes anything back.

1. **Connect.** Register an app in the Fortnox developer portal, create a free test company, and get service-account consent with scopes `bookkeeping`, `project`, `costcenter`, `supplierinvoice`, `supplier`, `payment`, `settings`, `inbox`, `archive`, `connectfile`, `companyinformation`. Store the client secret in Fly secrets.
2. **Mirror.** The `fx_*` tables, the first import for the current and previous year, and a treasurer-only page listing vouchers with their rows. Check totals against Fortnox's own balance report.
3. **Live updates.** The WebSocket worker, the nightly re-read, and the totals check.
4. **Project groups and budget.** `project_group` mapped to cost centres, `annual_budget` and `budget_amount` entered by the treasurer, and the year overview of budget vs actual.
5. **Classification.** The Unclassified list, splits, history and permissions; then suggestion rules.
6. **Missing receipts.** Object storage, upload with conversion and AI pre-fill, inbox upload and file connection to the existing voucher.
7. **Outlays and payouts.** Claims against funded projects, approval, vouchers in series U and UB, Wise batch drafts.
8. **Supplier invoices.** Classify unbooked invoices, set rows, then book.
9. **Optional later.** Monthly reclassification voucher to Fortnox; an open banking feed if live bank data turns out to matter.

Steps 1–4 give Alversjö budget tracking without any member-facing money features. Steps 5–6 bring members in.

## Things to verify

### In the Fortnox sandbox

- [ ] Exact SIE export endpoint and format for a full year
- [ ] Whether voucher row indices stay stable after a treasurer uses Ändra (struck rows kept, new rows appended)
- [ ] That `voucher-updated` events fire on Ändra edits
- [ ] Field names and formats for `Project` and `CostCenter` on voucher rows
- [ ] Voucher file connections with `?financialyear=`, and several files on one voucher
- [ ] Updating rows on an unbooked supplier invoice, then booking it through the API
- [ ] Whether any voucher delete exists, given the scope page's wording
- [ ] Locked period endpoint, so the platform knows the latest month that can take vouchers

### With the accountant

- [ ] Account map: which account ranges and cost centres each project group uses
- [ ] Two-step outlay booking via 2890, and VAT on volunteers' receipts
- [ ] Booking rhythm: how quickly bank transactions are booked, since that sets how fresh the platform is
- [ ] Whether project codes should exist in Fortnox at all, or only in the platform
- [ ] Financial year dates and when months are locked

## Sources

- [Fortnox: Open banking connection](https://support.fortnox.se/produkthjalp/bankkopplingar/snabbare-koppling-till-din-bank)
- [Fortnox: Bokföring från kontoutdrag, automatisk kontoavstämning](https://support.fortnox.se/produkthjalp/bokforing/bokforing-fran-kontoutdrag-automatisk-kontoavstamning)
- [Fortnox: Ta bort eller ändra felaktig verifikation](https://support.fortnox.se/produkthjalp/bokforing/ta-bort-eller-andra-felaktig-verifikation)
- [Fortnox developer: scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes)
- [Fortnox developer: WebSockets](https://www.fortnox.se/developer/guides-and-good-to-know/websockets)
- [Fortnox developer: vouchers best practice](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers)
- [Fortnox developer: rate limits](https://www.fortnox.se/developer/guides-and-good-to-know/rate-limits-for-fortnox-api)
- [Fortnox API reference](https://api.fortnox.se/apidocs)
- [Invantive forum: missing transactions endpoint (Jan 2025)](https://forums.invantive.com/t/fortnox-api-missing-functionality-transactions-endpoint/5142)
- [Borderland Dreamer Expense Manual](https://coda.io/@hugi/the-borderland-money-well/dreamer-expense-manual-1)
