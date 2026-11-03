import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readReceipt, RECEIPT_MODEL } from './ocr';

function fakeClient(result: { stop_reason?: string; parsed_output: unknown } | Error) {
  const parse = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return { stop_reason: 'end_turn', ...result };
  });
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe('readReceipt', () => {
  afterEach(() => { delete process.env.ANTHROPIC_API_KEY; });

  it('is off without an API key', async () => {
    expect(await readReceipt({ contentType: 'image/jpeg', data: Buffer.from('x') })).toBeNull();
  });

  it('turns the model output into öre and a checked date, sending the image', async () => {
    const { client, parse } = fakeClient({
      parsed_output: { merchant: ' Byggmax ', purchase_date: '2026-10-30', total: 125, vat: 25, currency: 'sek', description: 'Färg' },
    });
    expect(await readReceipt({ contentType: 'image/jpeg', data: Buffer.from('x') }, client)).toEqual({
      merchant: 'Byggmax', purchaseDate: '2026-10-30', totalOre: 12500, vatOre: 2500, currency: 'SEK', description: 'Färg',
    });
    const request = (parse.mock.calls[0] as unknown[])[0] as { model: string; messages: { content: { type: string }[] }[] };
    expect(request.model).toBe(RECEIPT_MODEL);
    expect(request.messages[0].content[0].type).toBe('image');
  });

  it('sends a PDF as a document and drops unreadable values', async () => {
    const { client, parse } = fakeClient({
      parsed_output: { merchant: '', purchase_date: '30/10', total: 0, vat: 0, currency: '', description: '' },
    });
    expect(await readReceipt({ contentType: 'application/pdf', data: Buffer.from('%PDF') }, client)).toMatchObject({
      purchaseDate: null, totalOre: null, vatOre: 0, currency: 'SEK',
    });
    const request = (parse.mock.calls[0] as unknown[])[0] as { messages: { content: { type: string }[] }[] };
    expect(request.messages[0].content[0].type).toBe('document');
  });

  it('returns null on refusal or error, and for unsupported file types', async () => {
    expect(await readReceipt({ contentType: 'image/jpeg', data: Buffer.from('x') }, fakeClient({ stop_reason: 'refusal', parsed_output: null }).client)).toBeNull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readReceipt({ contentType: 'image/jpeg', data: Buffer.from('x') }, fakeClient(new Error('boom')).client)).toBeNull();
    spy.mockRestore();
    expect(await readReceipt({ contentType: 'text/plain', data: Buffer.from('x') }, fakeClient({ parsed_output: {} }).client)).toBeNull();
  });
});
