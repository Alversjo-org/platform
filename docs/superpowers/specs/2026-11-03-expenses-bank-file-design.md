# Outlays (utlägg): receipts, approval, Fortnox booking, bank-file payouts

Step 7 of `2026-10-15-projects-events-cobudgeting-reference.md` ("Receipts and outlays"),
with one change from that note: payouts go through an **ISO 20022 payment file** (pain.001)
uploaded to the association's bank, not Wise batches. Booking follows the note's two-voucher
model (U at approval, UB at payout, via 2890).

## Flow

1. **Member** (`/expenses/new`): uploads 1–5 receipt photos/PDFs, enters what, shop, date,
   amount, VAT, optional project and note. The first file is read by Claude (if
   `ANTHROPIC_API_KEY` is set) to pre-fill the empty fields; the member checks them. The
   suggestion is stored on the outlay (`ocr_suggestion`) for comparison.
2. **Treasurer** (`/expenses/review` → `/expenses/<id>`): approves with cost account (default
   from settings), cost centre (default: the project's group's cost centre), optional Fortnox
   project and "reclaim VAT"; or rejects with a reason sent to the member. The submitter can
   withdraw while it's waiting.
3. **Booking at approval** (`src/lib/expenses/booking.ts`): voucher in series U on the purchase
   date — cost excl. VAT (with dimensions), input VAT 2640, credit 2890 with the member's name.
   Receipts are uploaded to the Fortnox voucher inbox (`inbox_v`) and attached with
   `voucherfileconnections`, passing `VoucherYear` so Fortnox can't attach them to another
   year's voucher (the OC-Wise-Fortnox script's "default year" problem). Failures are stored on
   the outlay and retried from its page.
4. **Payment file** (`/expenses/payments`): the treasurer picks approved, booked outlays whose
   member has a bank account and a payment date; the platform writes a pain.001.001.03 file
   (one batch debit, SEK, `src/lib/expenses/pain001.ts`). It's downloaded, uploaded in the
   bank's file transfer and signed there. The file is stored encrypted and every download is
   logged.
5. **Paid**: after the bank has executed it, the treasurer marks the file paid (date from the
   statement). Outlays become paid, members are emailed, and voucher UB books debit 2890 per
   outlay, credit the bank ledger account (1930). A file the bank rejected can be cancelled;
   its outlays go back to "ready to pay".

Every Fortnox write is idempotent: vouchers carry a comment (`alversjo-expense:<id>`,
`alversjo-payout:<id>`) and are looked up by it before being created, so a crash between
"Fortnox created it" and "we saved its number" never books twice. Missing voucher series are
created on first use. No new OAuth scopes: bookkeeping, inbox and connectfile were already
requested.

## Bank details (`/profile/bank`)

- IBAN (+ BIC, required outside Sweden) or Swedish clearing + account number. IBAN checksum
  and lengths are validated; Swedish numbers only by shape (4 digits, or 5 starting with 8 for
  Swedbank; account 5–10 digits) since per-bank check rules vary.
- Stored in `member_bank_account` encrypted with AES-256-GCM (`BANK_DATA_KEY`); only the last
  four digits and the holder name are stored in clear. Nothing renders the full number, also
  not for the treasurer; it exists in clear only inside the generated payment file.
- Every change or removal is logged (without the number) and emailed to the member, since a
  changed payout account is the classic outlay fraud.
- Without `BANK_DATA_KEY`, production refuses to store or read bank details; dev and tests use
  a fixed public key.

## Payment file details

pain.001.001.03, validated against the ISO XSD during development. One `PmtInf`, batch
booking, service level NURG, SEK.
- IBAN creditors: `CdtrAcct/IBAN`, BIC in `CdtrAgt` when known, `ChrgBr SHAR` for non-SE IBANs.
- Swedish accounts: `CdtrAcct/Othr` = clearing + account with scheme `BBAN`, clearing number as
  `ClrSysMmbId` with system `SESBA`.
- Initiating party: the bank's customer/agreement id if set in settings (scheme BANK),
  otherwise the organisation number.
- **Send a test file to the bank first**: banks differ in small details (initiating-party id,
  Swedbank's 5-digit clearings, foreign payments in SEK).

## Data

`member_bank_account`, `expense`, `expense_receipt` (file bytes in Postgres, `bytea`; photos
are rotated, shrunk to ≤2400 px and re-encoded as JPEG, which drops EXIF/GPS),
`payment_batch`, `expense_settings` (one row). Receipt and file downloads are route handlers
that check owner/treasurer. Outlays keep their member reference without cascade: bookkeeping
records outlive accounts.

## Defaults chosen (change if they're wrong)

- Approver: the treasurer (and Superadmin), not project leads.
- Amounts in SEK only; a foreign receipt is entered with what the bank charged in kronor.
- Max 100 000 kr per outlay, 5 files, 10 MB each, 25 MB per submission.
- Receipt reader model: Claude Opus 5.5 at low effort, with server-side fallback enabled.

## Not done

- Project leads approving within their budget.
- Reading bank statements to mark files paid automatically (no Fortnox/bank API for it).
- Swedish account-number check digits per bank.
- Converting the open question in the reference note: the accountant's view on reclaiming VAT
  on volunteers' receipts (the per-outlay "reclaim VAT" switch is the stopgap).
