import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AiConversationDto } from '@nexus/shared';
import { AssistantPage } from '../pages/AssistantPage';
import { renderWithProviders } from '@/test/utils';

const conversation: AiConversationDto = {
  id: 'c1',
  workspaceId: 'ws1',
  scope: 'workspace',
  scopeId: null,
  title: 'Launch plan',
  lastMessageAt: null,
  createdAt: new Date().toISOString(),
};

const { renameMock } = vi.hoisted(() => ({ renameMock: vi.fn() }));
vi.mock('../api', () => ({
  aiApi: {
    status: vi.fn(async () => ({ enabled: true, semanticSearch: false, model: 'claude-opus-5-5' })),
    conversations: vi.fn(async () => ({ items: [conversation], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } })),
    conversation: vi.fn(async () => ({ ...conversation, messages: [] })),
    renameConversation: renameMock,
    deleteConversation: vi.fn(),
  },
}));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/w/:workspaceId/assistant" element={<AssistantPage />} />
    </Routes>,
    { route: '/w/ws1/assistant' },
  );
}

describe('AssistantPage conversation list', () => {
  it('renames a conversation inline with Enter and cancels with Escape', async () => {
    renameMock.mockResolvedValue({ ...conversation, title: 'Q3 launch' });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Rename Launch plan' }));
    const input = screen.getByLabelText('Conversation title');
    await user.clear(input);
    await user.type(input, 'Q3 launch{Enter}');
    await waitFor(() => expect(renameMock).toHaveBeenCalledWith('c1', 'Q3 launch'));

    await user.click(screen.getByRole('button', { name: 'Rename Launch plan' }));
    await user.type(screen.getByLabelText('Conversation title'), ' draft{Escape}');
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Launch plan')).toBeInTheDocument();
  });
});
