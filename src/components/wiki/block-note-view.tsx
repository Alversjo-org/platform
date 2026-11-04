'use client';

import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';

/** Read-only render of a stored BlockNote document. BlockNote's view APIs are client-only. */
export function BlockNoteReadOnly({ content }: { content: unknown }) {
  const blocks = Array.isArray(content) && content.length > 0 ? (content as never) : undefined;
  const editor = useCreateBlockNote({ initialContent: blocks });
  return <BlockNoteView editor={editor} editable={false} theme="light" />;
}
