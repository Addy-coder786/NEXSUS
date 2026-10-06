import { lazy, Suspense } from 'react';
import type { DocumentEditorProps } from './DocumentEditor';
import { SkeletonLines } from '@/components/ui/skeleton';

const Editor = lazy(() => import('./DocumentEditor').then((m) => ({ default: m.DocumentEditor })));

/** Code-split wrapper so Tiptap only loads on document routes. */
export function LazyDocumentEditor(props: DocumentEditorProps) {
  return (
    <Suspense fallback={<SkeletonLines lines={8} className="prose-nexus pt-2" />}>
      <Editor {...props} />
    </Suspense>
  );
}

export function LazyReadOnlyDocument({ content, className }: Pick<DocumentEditorProps, 'content' | 'className'>) {
  return <LazyDocumentEditor content={content} editable={false} showToolbar={false} className={className} />;
}
