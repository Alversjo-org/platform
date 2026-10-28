DROP INDEX "fx_account_year_number_idx";--> statement-breakpoint
DROP INDEX "fx_voucher_key_idx";--> statement-breakpoint
DROP INDEX "fx_voucher_row_voucher_idx";--> statement-breakpoint
ALTER TABLE "fx_account" ADD CONSTRAINT "fx_account_year_number_key" UNIQUE("year","number");--> statement-breakpoint
ALTER TABLE "fx_voucher" ADD CONSTRAINT "fx_voucher_key" UNIQUE("year","series","number");--> statement-breakpoint
ALTER TABLE "fx_voucher_row" ADD CONSTRAINT "fx_voucher_row_key" UNIQUE("voucher_id","row_index");