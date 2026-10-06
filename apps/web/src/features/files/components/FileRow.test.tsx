import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FileDto } from '@nexus/shared';
import { FileRow } from './FileRow';
import { makeUser, renderWithProviders } from '@/test/utils';

function makeFile(overrides: Partial<FileDto> = {}): FileDto {
  return {
    id: 'f1',
    workspaceId: 'ws1',
    projectId: null,
    taskId: null,
    channelId: null,
    documentId: null,
    name: 'spec.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    kind: 'pdf',
    url: 'https://files.example.com/spec.pdf',
    thumbnailUrl: null,
    width: null,
    height: null,
    uploadedBy: makeUser({ name: 'Priya Sharma' }),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('FileRow', () => {
  it('renders the kind icon, name, size and uploader', () => {
    const file = makeFile();
    renderWithProviders(
      <table>
        <tbody>
          <FileRow file={file} actions={{ onPreview: vi.fn(), canManage: () => true }} />
        </tbody>
      </table>,
    );
    expect(screen.getByTestId('file-row').querySelector('[data-kind="pdf"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'spec.pdf' })).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions for spec.pdf/i })).toBeInTheDocument();
  });

  it('shows a thumbnail with empty alt for images instead of an icon', () => {
    const file = makeFile({ kind: 'image', name: 'hero.png', mimeType: 'image/png', thumbnailUrl: 'https://img/hero_thumb.png' });
    renderWithProviders(
      <table>
        <tbody>
          <FileRow file={file} actions={{ onPreview: vi.fn(), canManage: () => false }} />
        </tbody>
      </table>,
    );
    const img = screen.getByTestId('file-row').querySelector('img');
    expect(img).toHaveAttribute('src', 'https://img/hero_thumb.png');
    expect(img).toHaveAttribute('alt', '');
    expect(screen.getByTestId('file-row').querySelector('[data-kind]')).toBeNull();
  });
});
