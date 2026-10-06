import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <SimpleTooltip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn('text-muted-foreground', active && 'bg-accent text-foreground')}
      >
        {children}
      </Button>
    </SimpleTooltip>
  );
}

function normaliseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

/** Link dialog state shared by the toolbar and the bubble menu. */
export function useLinkDialog(editor: Editor | null) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const id = useId();

  const openDialog = useCallback(() => {
    if (!editor) return;
    const current = (editor.getAttributes('link') as { href?: string }).href ?? '';
    setUrl(current);
    setOpen(true);
  }, [editor]);

  const apply = () => {
    if (!editor) return;
    const href = normaliseUrl(url);
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setOpen(false);
  };

  const element = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Link</DialogTitle>
          <DialogDescription>Paste a URL. Leave empty to remove the link.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-url`}>URL</Label>
            <Input
              id={`${id}-url`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              autoFocus
              inputMode="url"
            />
          </div>
          <DialogFooter>
            {editor?.isActive('link') ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  setOpen(false);
                }}
              >
                <Unlink /> Remove
              </Button>
            ) : null}
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { open: openDialog, element };
}

interface EditorToolbarProps {
  editor: Editor;
  onUploadImage?: (file: File) => Promise<string>;
  linkDialog: ReturnType<typeof useLinkDialog>;
}

export function EditorToolbar({ editor, onUploadImage, linkDialog }: EditorToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrlOpen, setImageUrlOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const id = useId();

  const insertImage = (src: string) => {
    editor.chain().focus().setImage({ src }).run();
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file || !onUploadImage) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files can be inserted');
      return;
    }
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      insertImage(url);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Upload failed'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const can = editor.can();

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      aria-orientation="horizontal"
      className="sticky top-0 z-10 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 rounded-md border bg-card/95 px-1 py-0.5 shadow-sm backdrop-blur"
    >
      <ToolbarButton label="Undo" disabled={!can.undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label="Redo" disabled={!can.redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton label="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
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
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolbarButton>
      <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton label="Task list" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListTodo />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote />
      </ToolbarButton>
      <ToolbarButton label="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <SquareCode />
      </ToolbarButton>
      <ToolbarButton label="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus />
      </ToolbarButton>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolbarButton label="Link" active={editor.isActive('link')} onClick={linkDialog.open}>
        <Link2 />
      </ToolbarButton>

      <DropdownMenu>
        <SimpleTooltip label="Image">
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Insert image" className="text-muted-foreground" loading={uploading}>
              <ImagePlus />
            </Button>
          </DropdownMenuTrigger>
        </SimpleTooltip>
        <DropdownMenuContent align="start">
          {onUploadImage ? (
            <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>Upload from computer</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              setImageUrl('');
              setImageUrlOpen(true);
            }}
          >
            From URL
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void onPickFile(e.target.files?.[0])}
      />

      <DropdownMenu>
        <SimpleTooltip label="Table">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Table"
              className={cn('text-muted-foreground', editor.isActive('table') && 'bg-accent text-foreground')}
            >
              <Table2 />
            </Button>
          </DropdownMenuTrigger>
        </SimpleTooltip>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          >
            Insert 3 × 3 table
          </DropdownMenuItem>
          {editor.isActive('table') ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => editor.chain().focus().addRowAfter().run()}>Add row below</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().addColumnAfter().run()}>Add column right</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().deleteRow().run()}>Delete row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor.chain().focus().deleteColumn().run()}>Delete column</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => editor.chain().focus().deleteTable().run()}>
                Delete table
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={imageUrlOpen} onOpenChange={setImageUrlOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert image</DialogTitle>
            <DialogDescription>Paste the address of an image on the web.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const src = normaliseUrl(imageUrl);
              if (!src) return;
              insertImage(src);
              setImageUrlOpen(false);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-img`}>Image URL</Label>
              <Input
                id={`${id}-img`}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…/picture.png"
                autoFocus
                inputMode="url"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!imageUrl.trim()}>
                Insert
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
