import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConversationDto, AiMessageDto, AiStreamEvent } from '@nexus/shared';
import { AssistantChat } from '../components/AssistantChat';
import type * as StreamModule from '../stream';
import { renderWithProviders } from '@/test/utils';

const { createMock, conversationMock, streamMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  conversationMock: vi.fn(),
  streamMock: vi.fn(),
}));

vi.mock('../api', () => ({
  aiApi: {
    createConversation: createMock,
    conversation: conversationMock,
    conversations: vi.fn(async () => ({ items: [], meta: {} })),
  },
}));
vi.mock('../stream', async (importOriginal) => ({
  ...(await importOriginal<typeof StreamModule>()),
  streamAssistantMessage: streamMock,
}));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));

const conversation: AiConversationDto = {
  id: 'c1',
  workspaceId: 'ws1',
  scope: 'workspace',
  scopeId: null,
  title: 'New conversation',
  lastMessageAt: null,
  createdAt: new Date().toISOString(),
};

function message(overrides: Partial<AiMessageDto>): AiMessageDto {
  return {
    id: Math.random().toString(36).slice(2),
    conversationId: 'c1',
    role: 'assistant',
    content: '',
    sources: [],
    toolCalls: [],
    suggestedAction: null,
    status: 'complete',
    error: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  createMock.mockResolvedValue(conversation);
  conversationMock.mockResolvedValue({ ...conversation, messages: [] });
});

describe('AssistantChat', () => {
  it('creates a conversation on the first message and renders the streamed answer with sources', async () => {
    let finish: () => void = () => undefined;
    streamMock.mockImplementation(
      async (_id: string, content: string, onEvent: (e: AiStreamEvent) => void) => {
        onEvent({ type: 'user_message', message: message({ role: 'user', content }) });
        onEvent({
          type: 'tool_call',
          toolCall: { name: 'list_tasks', label: 'Listed tasks', resultCount: 2 },
        });
        onEvent({ type: 'text_delta', text: 'You have **two** tasks' });
        await new Promise<void>((resolve) => (finish = resolve));
        onEvent({
          type: 'done',
          message: message({
            content: 'You have **two** tasks: WEB-1 and WEB-2.',
            toolCalls: [{ name: 'list_tasks', label: 'Listed tasks', resultCount: 2 }],
            sources: [
              {
                type: 'task',
                id: 't1',
                title: 'WEB-1 Fix login',
                link: '/w/ws1/projects/p1/board?task=t1',
                snippet: 'TODO',
              },
            ],
            suggestedAction: { type: 'generate_tasks', text: 'plan' },
          }),
        });
      },
    );
    const onCreated = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AssistantChat
        workspaceId="ws1"
        conversationId={undefined}
        onConversationCreated={onCreated}
      />,
    );

    await user.type(screen.getByLabelText('Message the assistant'), 'What is on my plate?{Enter}');

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('c1'));
    expect(createMock).toHaveBeenCalledWith('ws1', {});
    expect(streamMock).toHaveBeenCalledWith(
      'c1',
      'What is on my plate?',
      expect.any(Function),
      expect.any(AbortSignal),
    );

    // While streaming: the live tool label and partial Markdown.
    expect(await screen.findByText('Listed tasks…')).toBeInTheDocument();
    expect(screen.getByText('two').tagName).toBe('STRONG');
    expect(screen.getByLabelText('Stop')).toBeInTheDocument();

    finish();
    expect(await screen.findByRole('link', { name: 'WEB-1 Fix login' })).toHaveAttribute(
      'href',
      '/w/ws1/projects/p1/board?task=t1',
    );
    expect(screen.getByText('Looked at 1 source')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create these tasks/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Send')).toBeInTheDocument();
  });

  it('shows the error from a failed turn', async () => {
    conversationMock.mockResolvedValue({ ...conversation, messages: [] });
    streamMock.mockImplementation(
      async (_id: string, _c: string, onEvent: (e: AiStreamEvent) => void) => {
        onEvent({
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'The AI service is busy. Please try again shortly.',
        });
      },
    );
    const user = userEvent.setup();
    renderWithProviders(<AssistantChat workspaceId="ws1" conversationId="c1" />);
    await user.click(await screen.findByRole('button', { name: 'What is overdue right now?' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The AI service is busy');
  });
});
