import { useEffect, useMemo } from 'react';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import type { RichContent } from '@nexus/shared';
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough, Underline as UnderlineIcon } from 'lucide-react';
import { buildExtensions } from './extensions';
import { EditorToolbar, ToolbarButton, useLinkDialog } from './EditorToolbar';
import { cn } from '@/lib/utils';

export interface DocumentEditorProps {
  content: RichContent;
  editable?: boolean;
  placeholder?: string;
  /** Called with the full JSON document after every change. */
  onChange?: (json: RichContent, editor: Editor) => void;
  /** Uploads an image file and resolves to its URL; enables the toolbar's upload option. */
  onUploadImage?: (file: File) => Promise<string>;
  showToolbar?: boolean;
  className?: string;
  /** Forwarded so the parent can focus the editor after the title. */
  onReady?: (editor: Editor) => void;
}

export function DocumentEditor({
  content,
  editable = true,
  placeholder = 'Start writing, or paste anything…',
  onChange,
  onUploadImage,
  showToolbar = true,
  className,
  onReady,
}: DocumentEditorProps) {
  const extensions = useMemo(() => buildExtensions(placeholder), [placeholder]);
  const editor = useEditor({
    extensions,
    content: content as unknown as JSONContent,
    editable,
    editorProps: {
      attributes: {
        class: 'tiptap',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Document body',
      },
    },
    onUpdate: ({ editor: e }) => onChange?.(e.getJSON() as RichContent, e),
    onCreate: ({ editor: e }) => onReady?.(e),
  });

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  const linkDialog = useLinkDialog(editor);

  if (!editor) return <div className={cn('prose-nexus min-h-48', className)} aria-busy="true" />;

  return (
    <div className={cn('flex flex-col', className)}>
      {showToolbar && editable ? <EditorToolbar editor={editor} onUploadImage={onUploadImage} linkDialog={linkDialog} /> : null}
      {editable ? (
        <BubbleMenu
          editor={editor}
          tippyOptions={{ duration: 100, placement: 'top' }}
          shouldShow={({ editor: e, from, to }) =>
            from !== to && !e.isActive('image') && !e.isActive('codeBlock') && e.isEditable
          }
          className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-lg"
        >
          <ToolbarButton label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold />
          </ToolbarButton>
          <ToolbarButton label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic />
          </ToolbarButton>
          <ToolbarButton label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon />
          </ToolbarButton>
          <ToolbarButton label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough />
          </ToolbarButton>
          <ToolbarButton label="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code />
          </ToolbarButton>
          <ToolbarButton label="Highlight" active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}>
            <Highlighter />
          </ToolbarButton>
          <ToolbarButton label="Link" active={editor.isActive('link')} onClick={linkDialog.open}>
            <Link2 />
          </ToolbarButton>
        </BubbleMenu>
      ) : null}
      <div className="prose-nexus flex-1">
        <EditorContent editor={editor} />
      </div>
      {linkDialog.element}
    </div>
  );
}

/** Read-only renderer for version previews and other static displays. */
export function ReadOnlyDocument({ content, className }: { content: RichContent; className?: string }) {
  return <DocumentEditor content={content} editable={false} showToolbar={false} className={className} />;
}
