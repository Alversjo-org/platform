# Alversjö platform: projects, events and co-budgeting reference

Oct 15, 2026 · @Viktor

## Summary

Alversjö should build projects, events and co-budgeting as modules inside its own platform (`Alversjo-org/platform`), with Fortnox as the only ledger and Cobudget used as a specification rather than a dependency.

- **One core entity.** A *project* is anything money or people gather around. An *event* is a project with a time, a capacity, a cost and the areas it uses. A *dream* is a project in its proposal and funding stage.
- **Three kinds of budgeting share one model.** Dreams for events, project groups inside the current annual budget, and next year's annual budget are all *rounds* that allocate money from a *fund* to *projects*.
- **Money stays in Fortnox.** Fortnox holds accounts, VAT and the fund as a cost centre. The platform holds which project a cost belongs to, the budgets, and the decisions, and reads actuals from Fortnox. That side is specified in the companion document on Fortnox data and budget tracking.
- **Familiar to Borderlanders.** Keep the Cobudget/Open Collective pattern people know: propose, fund, then spend against the grant with receipts. Rebuild it in Alversjö's own stack instead of running Borderland's tools.

The first step is an events module with sign-ups, which needs no money flow and gives the project entity its first real use.

[embedded content: how the parts fit · project at the centre]

Budgets and rounds put money on projects, Fortnox supplies what was actually spent, and events add sign-ups and areas on top of the same project.

## Context

Alversjö holds the land rented to the Borderland festival each year, and most active people are long-time Borderland community members. Tools that feel like Borderland's (Cobudget dreams, Open Collective receipts) lower the threshold, but Alversjö must run its own instance, separate from Borderland's.

| Thing | What it is | Relevance |
| --- | --- | --- |
| Alversjö Natur AB | Org.nr 559357-0145, aktiebolag, VAT-registered, about 3.7 MSEK turnover in 2025 (public records) | Appears to be the bookkeeping entity. Confirm before building: it decides VAT handling, K2/K3 and whether booking at payment is allowed. |
| Alversjö platform | `Alversjo-org/platform`: Next.js 16, Drizzle on Fly Postgres, BetterAuth email codes, Stripe memberships, Resend | Where all new modules go |
| Fortnox | Alversjö's bookkeeping; supplier-invoice module can be enabled | The only ledger |
| Borderland / Föreningen Gränslandet | Separate förening; runs Cobudget, Open Collective, Wise and the OC-Wise-Fortnox job | Pattern to borrow; never shared data by default |
| The Global Burn | Borderland's membership and ticketing app (Next.js 15 + Supabase) | Possible "Sign in with Borderland" |

The land itself is outside Eksjö in Jönköping county.

## Concepts and vocabulary

These terms should mean the same thing in code, in the interface and in conversations with the accountant.

| Term | Meaning on the platform | Cobudget equivalent | Fortnox equivalent |
| --- | --- | --- | --- |
| Project | Anything with a purpose, people and possibly money: a build, a working group, a recurring activity, an event | Bucket | Project (optional dimension) |
| Event | A project with time, capacity, cost and areas; members can sign up | None; buckets have no dates | None |
| Dream | A project in proposal or funding state | Bucket in IDEA / OPEN_FOR_FUNDING | None |
| Project group | A budget area grouping projects, e.g. "Infrastructure" or "Kitchen" | None | Cost centre, or a range of projects |
| Fund | A pot of earmarked money: a grant, a dream round, an annual budget line | Round (implicitly) | Cost centre |
| Round | A time-boxed decision about how a fund is spread over projects | Round | None |
| Allocation | Money from a fund reserved for a project, by decision | Allocation + Contribution | None (decision data) |
| Budget line | Planned income or cost inside a project, with min and optional max | BudgetItem | None |
| Annual budget | Planned amounts per project group, account range and month for one financial year | None | Fortnox has a budget view, but no API for it |
| Actual | A booked cost or income row read from Fortnox | Expense (only via OC) | Voucher row |
| Classification | The platform's decision about which project an actual belongs to | Expense → bucket link | Project on the row, optional |
| Expense / utlägg | A member's claim to be paid back, with receipts | Expense | Voucher in series U, crediting 2890 |
| Receipt | The image or PDF behind a cost; part of the verifikation | ExpenseReceipt | File in the inbox, connected to the voucher |
| Payout | Money sent back to the member | OC + Wise | Voucher in series UB, clearing 2890 against the bank or Wise account |

Allocations, contributions and budget lines are decision data and are never booked. Only actuals and payouts are bookkeeping.

## Resources explored

Each resource below was read or cloned during the session; the right-hand column is what Alversjö should take from it.

| Resource | What it is | Key findings | Take for Alversjö |
| --- | --- | --- | --- |
| [Cobudget](https://github.com/cobudget/cobudget) | Co-budgeting app. Next.js pages router, Apollo GraphQL, Prisma 5, Postgres, MUI + Tailwind, magic-link login, Cloudinary. AGPL with extra attribution terms. | Live work is on the `prod` (cobudget.com) and `borderland` branches; they have drifted about 335 files apart. Expense statuses are a flat copy of Open Collective's with no transition rules or history. Receipts go to public Cloudinary under the maintainers' account. The OC integration is about 750 lines. Public rounds can be read without login over GraphQL. | The ontology (round, bucket, budget items, allocations, contributions, funding states, guidelines and flags) and the granting rules, as a spec. Not the code. |
| [Open Collective](https://github.com/opencollective) | Fiscal-hosting platform, run since 2024 by the non-profit OFiCo. MIT code. | Projects and events are child accounts with their own balances. Expense flow: draft → pending → approved → paid, receipts private, payouts via Wise. Host pricing since March 2026: free up to 1 collective and 10 paid expenses a month, then $60/month. No Fortnox integration. Not realistic to self-host. | The receipt rules and the status flow. Not the platform or the code. |
| [OC-Wise-Fortnox integration](https://github.com/zaunders/OC-Wise-Fortnox-integration) | Gränslandet's Python cron job: Wise payouts matched to OC expenses → one Fortnox voucher each | No VAT rows, no projects or cost centres, only a PDF of links to the receipts, refund reversal will crash, inbox folder probably ignored | Matching and deduplication ideas; the bug list is in the first report |
| [Fortnox API](https://api.fortnox.se/apidocs) | REST API, OAuth2 or service account, 300 requests/min, WebSocket change events | Vouchers can only be created and read. Inbox upload + voucher file connections attach receipts. Projects and cost centres are row dimensions. No API for bank transactions or budgets. | Book once, read actuals, attach receipts |
| [The Global Burn](https://github.com/hermesloom/theglobalburn) | Borderland membership, lottery, ticketing and check-in. Next.js 15 + Supabase. GPL-3.0. | Has `burn_ideas` with votes and `burn_timeline_events`, no budgets. Issues 2-minute RS256 tokens with a public JWKS endpoint for the Realities app. API-key endpoints `check-membership` and `members-cobudget`. | "Sign in with Borderland" via that token handoff or Supabase OIDC; membership check by email |
| [Alversjö platform](https://github.com/Alversjo-org/platform) | Next.js 16 App Router, React 19, shadcn, Drizzle on Fly Postgres, BetterAuth email codes, Stripe memberships, Resend | Single organisation; roles member / member-admin / admin; no object storage yet; specs written in `docs/superpowers` | Home for every module in this document |
| Payout rails | Wise API, Swish Utbetalning, ISO 20022 bank files, Fortnox supplier-invoice payments | Wise can draft batches, but an EU business must fund them in the Wise app. The LB file format is gone in 2026. Fortnox only pays supplier invoices. | Wise batches by default, bank file as fallback |
| Swedish rules | Bokföringslagen, BFNAR 2013:2, Skatteverket on outlays | A verifikation must show date, content, amount and counterparty. Keep records 7 years. Paper may be destroyed after safe digitisation (since July 2024). Reimbursing documented outlays is not taxable income. | Store receipt originals in Fortnox, book outlays in two steps via 2890 |

## Decisions and recommendations

The direction moved during the session from "integrate Cobudget, Open Collective and Fortnox" to "build it in Alversjö's platform, with Fortnox as the ledger".

| Topic | Recommendation | How it changed |
| --- | --- | --- |
| Open Collective | Leave it out. Borrow its receipt rules and status flow. | Started as "use OC's receipt code?". The code is tied to OC's monolith, and hosting costs $60/month above 10 paid expenses. |
| Cobudget | Use it as the specification for co-budgeting. Optionally run a near-stock, separate instance for the first round while the platform's own version is built. | Started as "run Cobudget". With AI writing the code, a standalone build in the platform became the better end state. |
| Where code lives | All modules in `Alversjo-org/platform` (Drizzle, BetterAuth, shadcn) | The first report assumed Supabase; the platform's actual stack replaced that. |
| Member outlays | Two vouchers: series U at approval (cost + 2640 VAT, credit 2890), series UB at payout (debit 2890, credit the Wise or bank account, fees to 6570) | Supplier invoices per member were considered and rejected as unusual practice. |
| Payouts | Wise batches: the platform drafts, the treasurer funds in the Wise app. ISO 20022 bank file as fallback; Swish Utbetalning later. | Fortnox can't pay vouchers, only supplier invoices. |
| Which project a cost belongs to | Kept in the platform with full history. Fortnox gets account, VAT and fund. Projects are pushed to Fortnox only as a monthly or yearly batch reclassification, if at all. | The API can't edit vouchers, so per-change pushes would add a voucher each time. |
| Where costs come from | Read actuals from Fortnox. Members attach receipts to existing vouchers, or submit outlays that become vouchers. | No bank connection to the platform; see the companion document. |
| Identity | Keep Alversjö's own login. Add "Sign in with Borderland" as an optional linked login, matched by email. | Shared cookies across the two domains are impossible. |
| Borderland data | No bulk syncing of members. A membership check by email, if Borderland issues an API key. | Two separate legal controllers of personal data. |

## Data model proposal

One `project` table carries everything; event fields and budget fields are optional parts of it, not separate entity types. Tables below are Drizzle tables in the platform's own Postgres, next to BetterAuth's `user`.

| Table | Purpose | Key fields |
| --- | --- | --- |
| `project` | Every project, dream and event | id, slug, title, summary, body, kind (`event` / `ongoing` / `build` / `purchase`), status, visibility (`private` / `members` / `public`), project_group_id, owner_user_id, fortnox_project_code (optional), created_at |
| `project_member` | Who runs it | project_id, user_id, role (`lead` / `cocreator` / `treasurer`) |
| `event_details` | Present only when the project is an event | project_id, starts_at, ends_at, capacity, signup_opens_at, signup_closes_at, price_sek (0 = free), price_note, contact_note |
| `area` | Named places on the land | id, name, description, capacity, bookable (yes/no), map_ref |
| `event_area` | Which areas an event uses, and when | event_id, area_id, from, to, setup_note. Overlaps on the same area are flagged. |
| `event_signup` | Member sign-ups | event_id, user_id, status (`going` / `waitlist` / `cancelled`), seats (1 + guests), note, created_at. Unique per event and user. |
| `project_group` | Budget areas in the annual budget | id, name, cost_centre (Fortnox), parent_id |
| `fund` | Earmarked money | id, name, source (`annual_budget` / `dream_round` / `grant`), fiscal_year, cost_centre, amount_sek |
| `round` | A time-boxed decision over a fund | id, fund_id, kind (`dreams` / `group_budget` / `annual_budget`), opens_at, closes_at, max_per_member, rules |
| `budget_line` | Planned income and cost per project | project_id, round_id, description, kind (`cost` / `income`), min_sek, max_sek |
| `allocation` | Member credits in a round, and their contributions to projects | round_id, user_id, project_id (null = credit not yet given), amount_sek, created_at. Reversals as new rows. |
| `decision_log` | Who changed what, when and why | entity, entity_id, actor_user_id, action, diff, created_at |

Amount fields ending in `_sek` hold whole öre as integers, never floats. Every table that holds decisions is append-only or logged, because people will ask later why money went where it did.

## Events: minimum information and sign-ups

An event can't be published without the four required facts: when, how many, what it costs, and which areas it uses.

| Field | Required | Notes |
| --- | --- | --- |
| Title and short description | Yes | Shown in lists and the public calendar |
| When: start and end | Yes | Date and time in Europe/Stockholm. Multi-day allowed. A recurring series is several events sharing a parent project. |
| Capacity | Yes | Number of participants. "No limit" is an explicit choice, not an empty field. Capacity may also be capped by the areas used. |
| Cost | Yes | 0 = free. Otherwise a price per person and a note (what it covers). Paid sign-up through Stripe is a later step; at first, cost is information only. |
| Areas used | Yes, at least one | Picked from `area`, with the time each area is needed (setup and teardown can be wider than the event). Overlapping use of a bookable area is warned about. |
| Organisers | Yes | At least one `project_member` with role lead |
| Visibility | Yes | Members only, or public (shown on the website) |
| Sign-up window | No | Defaults to open from publishing until the start |
| Budget | No | An event that needs money gets budget lines and can enter a dreams round, like any project |

### Sign-up flow

1. A logged-in member presses **Sign up**. If seats are left, the status becomes `going`; if full, `waitlist`.
2. A cancellation frees a seat, and the first person on the waitlist moves to `going` and gets an email (Resend, already in the platform).
3. Organisers see the list with names, guests and notes, and can export it or message everyone.
4. A seat count and a waitlist count show on the event page. Names show only to organisers and, optionally, to other participants.

The seat check must run inside a database transaction with a row lock on the event, so two people can't take the last seat at the same moment.

## Co-budgeting: three uses, one mechanism

Events, project groups in the current budget and next year's budget all run as rounds: a fund, a set of projects with budget lines, a time window, and a rule for who decides.

| Round kind | Fund | Who decides | Outcome |
| --- | --- | --- | --- |
| Dreams (events and small projects) | A pot set aside in the annual budget, e.g. "Dreams 2027" | Members spread credits over proposals, Cobudget-style. Caps per member and per project. | Allocations per project; funded projects open for spending and receipts |
| Project group budget (current year) | One project group's line in this year's budget, e.g. "Infrastructure 120 000 kr" | The group's members, by credits or by consent in a meeting recorded in the platform | Allocations to the group's projects. Re-runnable when plans change mid-year. |
| Next year's budget | The expected total income for next year | Proposals from each group, then the board or the annual meeting approves | An approved annual budget: amounts per project group and month, which actuals are tracked against |

### Rules to carry over from Cobudget and Borderland

- A project shows its minimum and maximum (stretch) goal. It counts as funded at the minimum.
- A member can't put more than the round's cap into one project.
- Funding opens and closes at set times. After closing, unfunded projects return their credits.
- Guidelines with flags: anyone can flag a proposal against a guideline, and the flag must be resolved before funding.
- Spending opens only on funded projects, and only up to the allocation. Overspending is a separate, visible request.

### Next year's budget process

1. Each project group drafts its proposal in the platform: projects, budget lines, expected income.
2. The platform sums the proposals against expected income and shows the gap.
3. Members comment and, if wanted, run an advisory credit round to show priorities.
4. The board or annual meeting approves. The approved version is frozen as `annual_budget` with a version number.
5. From the start of the financial year the platform tracks Fortnox actuals against it, as described in the companion document.

## Good first steps

Start with events and sign-ups: they need no money flow, they give `project` its first real use, and members will use them every week. Each step is a spec + plan in `docs/superpowers`, as the platform already works.

1. **Projects and events (no money).** Tables `project`, `project_member`, `event_details`, `area`, `event_area`. Create, edit and publish an event with the four required facts. Members-only and public lists, an event page, an iCal feed.
2. **Sign-ups.** `event_signup` with capacity, waitlist, cancellation and promotion emails. Organiser list and CSV export.
3. **Areas.** Admin-managed list of areas; overlap warnings when two events want the same bookable area at the same time; a simple per-area calendar.
4. **Project groups and the annual budget (read-only first).** `project_group`, `fund`, and the approved annual budget entered by the treasurer. Link projects to groups. This is the frame the companion document's tracking hangs on.
5. **Fortnox read-only.** Service-account connection, sync of vouchers, accounts, projects and cost centres. Show actuals per project group against the budget. Details in the companion document.
6. **Dreams round.** `round`, `budget_line`, `allocation`, with Cobudget's rules as tests written before the implementation. Run the first round on a small fund. Optionally run that first round on a near-stock Cobudget instance while this is built, then replay its data against the platform's version.
7. **Receipts and outlays.** Upload against funded projects, approval, Fortnox vouchers in series U and UB, Wise batch payouts.
8. **Next year's budget.** Proposals per project group, the gap view, approval and freezing.

New platform roles needed along the way: `treasurer` (approves outlays, edits budgets) and an organiser role per project, held in `project_member`.

## Open questions

- [ ] Is Alversjö Natur AB the entity whose books this goes into, or is there a separate förening for the community's activities?
- [ ] Does the accountant agree with two-step outlay booking via 2890, and with reclaiming VAT on volunteers' receipts?
- [ ] K2 or K3, and how should unspent earmarked money be shown at year end?
- [ ] Is the financial year the calendar year?
- [ ] Does Wise onboard Alversjö's entity type, and which bank does Alversjö use (for the fallback payment file)?
- [ ] Who decides each project group's budget: the group by credits, by consent, or the board?
- [ ] Should event sign-ups ever take payment, or stay information-only?
- [ ] Would Borderland's maintainers add Alversjö to their token handoff, or enable Supabase OIDC, for "Sign in with Borderland"?
- [ ] Which areas of the land are bookable, and who manages the list?

## Sources

- [cobudget/cobudget](https://github.com/cobudget/cobudget) (branches main, prod, borderland)
- [Open Collective](https://github.com/opencollective), [pricing](https://opencollective.com/pricing), [Projects docs](https://docs.opencollective.com/help/collectives/projects)
- [zaunders/OC-Wise-Fortnox-integration](https://github.com/zaunders/OC-Wise-Fortnox-integration)
- [hermesloom/theglobalburn](https://github.com/hermesloom/theglobalburn)
- [Alversjo-org/platform](https://github.com/Alversjo-org/platform)
- [Fortnox API docs](https://api.fortnox.se/apidocs), [vouchers best practice](https://www.fortnox.se/developer/guides-and-good-to-know/best-practices/vouchers), [scopes](https://www.fortnox.se/developer/guides-and-good-to-know/scopes), [WebSockets](https://www.fortnox.se/developer/guides-and-good-to-know/websockets)
- [Borderland Dreamer Expense Manual](https://coda.io/@hugi/the-borderland-money-well/dreamer-expense-manual-1)
- [Bokföringslagen](https://lagen.nu/1999:1078), [BFN on digitised records](https://www.bfn.se/vad-innebar-den-andrade-regeln-om-overforing-av-rakenskapsinformation-i-bokforingslagen/)
- [Supabase as an OAuth/OIDC provider](https://dev.to/supabase/build-sign-in-with-your-app-using-supabase-auth-cc6), [BetterAuth generic OAuth](https://better-auth.com/docs/plugins/generic-oauth)
- Earlier reports in this session: *Cobudget projects and receipts stack* and *Volunteer outlays payouts and Cobudget reuse*
