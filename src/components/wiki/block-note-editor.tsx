'use client';

import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useState } from 'react';

async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/wiki/upload-image', { method: 'POST', body });
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Image upload failed');
  return json.url;
}

/** Editable BlockNote. Mirrors the document into a hidden form field `name` as JSON so a plain <form> action can save it. */
export function BlockNoteEditor({ initialContent, name = 'content' }: { initialContent: unknown; name?: string }) {
  const initial = Array.isArray(initialContent) && initialContent.length > 0 ? (initialContent as never) : undefined;
  const editor = useCreateBlockNote({ initialContent: initial, uploadFile });
  const [json, setJson] = useState(() => JSON.stringify(editor.document));
  return (
    <>
      <input type="hidden" name={name} value={json} />
      <BlockNoteView editor={editor} theme="light" onChange={() => setJson(JSON.stringify(editor.document))} />
    </>
  );
}
