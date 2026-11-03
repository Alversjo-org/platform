import { describe, expect, it } from 'vitest';
import { extractPlainText } from './text';

describe('extractPlainText', () => {
  it('concatenates text across paragraphs, in order', () => {
    const blocks = [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }], children: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'world' }], children: [] },
    ];
    expect(extractPlainText(blocks)).toBe('Hello world');
  });

  it('recurses into nested (child) blocks', () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'text', text: 'parent' }], children: [
      { type: 'paragraph', content: [{ type: 'text', text: 'child' }], children: [] },
    ] }];
    expect(extractPlainText(blocks)).toBe('parent child');
  });

  it('skips blocks with no text content (e.g. an image block) without crashing', () => {
    const blocks = [{ type: 'image', props: { url: 'x.webp' }, content: undefined, children: [] }];
    expect(extractPlainText(blocks)).toBe('');
  });

  it('returns an empty string for an empty document', () => {
    expect(extractPlainText([])).toBe('');
  });

  it('reads text inside link inline nodes and tolerates non-array input', () => {
    const blocks = [{ type: 'paragraph', content: [{ type: 'link', href: 'x', content: [{ type: 'text', text: 'click' }] }], children: [] }];
    expect(extractPlainText(blocks)).toBe('click');
    expect(extractPlainText(null)).toBe('');
  });

  it('reads table cell text', () => {
    const blocks = [{ type: 'table', content: { type: 'tableContent', rows: [{ cells: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]] }] }, children: [] }];
    expect(extractPlainText(blocks)).toBe('a b');
  });
});
