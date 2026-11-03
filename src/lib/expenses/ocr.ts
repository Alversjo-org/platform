import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

/**
 * Reads a receipt (photo or PDF) with Claude and suggests the fields of an outlay. Suggestions
 * only: the member checks and corrects them before submitting. Without ANTHROPIC_API_KEY, or on
 * any error, it returns null and the form simply stays empty.
 */

export const RECEIPT_MODEL = 'claude-opus-5-5';

const ReceiptSchema = z.object({
  merchant: z.string().describe('Shop or company name as printed on the receipt; empty if unreadable'),
  purchase_date: z.string().describe('Date of purchase as YYYY-MM-DD; empty if not visible'),
  total: z.number().describe('Total amount paid, including VAT, in the receipt currency; 0 if not visible'),
  vat: z.number().describe('Total VAT (moms) on the receipt, all rates together, in the receipt currency; 0 if none is shown'),
  currency: z.string().describe('ISO 4217 code of the amounts, e.g. SEK, EUR'),
  description: z.string().describe('A few words on what was bought, in the language of the receipt, e.g. "Färg och penslar"'),
});

export type ReceiptSuggestion = {
  merchant: string;
  purchaseDate: string | null; // YYYY-MM-DD
  totalOre: number | null;
  vatOre: number | null;
  currency: string;
  description: string;
};

export type ReceiptInput = { contentType: string; data: Buffer };

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const PROMPT =
  'This is a receipt or invoice that a member of a Swedish non-profit paid for themselves and wants reimbursed. ' +
  'Read it and fill in the fields. Use the amounts exactly as printed (no rounding beyond öre/cents). ' +
  'If a field is not visible, use the empty value described for it rather than guessing.';

function toOre(amount: number): number | null {
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

export function isReceiptReaderEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function readReceipt(input: ReceiptInput, client?: Anthropic): Promise<ReceiptSuggestion | null> {
  if (!client && !isReceiptReaderEnabled()) return null;
  const isPdf = input.contentType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.includes(input.contentType as ImageType)) return null;
  const data = input.data.toString('base64');
  const file: Anthropic.Beta.BetaContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: input.contentType as ImageType, data } };

  try {
    const anthropic = client ?? new Anthropic();
    const response = await anthropic.beta.messages.parse({
      model: RECEIPT_MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(ReceiptSchema) },
      messages: [{ role: 'user', content: [file, { type: 'text', text: PROMPT }] }],
    });
    if (response.stop_reason === 'refusal') return null;
    const r = response.parsed_output;
    if (!r) return null;
    return {
      merchant: r.merchant.trim(),
      purchaseDate: /^\d{4}-\d{2}-\d{2}$/.test(r.purchase_date) ? r.purchase_date : null,
      totalOre: toOre(r.total),
      vatOre: r.vat > 0 ? toOre(r.vat) : 0,
      currency: (r.currency || 'SEK').toUpperCase().slice(0, 3),
      description: r.description.trim(),
    };
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error(`receipt reader: API error ${e.status}: ${e.message}`);
    else console.error('receipt reader failed', e);
    return null;
  }
}
