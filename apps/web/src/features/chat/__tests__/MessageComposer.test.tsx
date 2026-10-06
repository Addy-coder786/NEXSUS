import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageComposer } from '../components/MessageComposer';
import { makeUser, renderWithProviders } from '@/test/utils';

vi.mock('@/lib/socket', () => ({ socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false } }));
vi.mock('@/features/chat/api', () => ({ chatApi: { uploadAttachment: vi.fn() } }));

const members = [makeUser({ name: 'Alice Smith' }), makeUser({ name: 'Bob Jones' }), makeUser({ name: 'Alan Turing' })];

function setup(props: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  const onSend = vi.fn();
  const onTyping = vi.fn();
  const utils = renderWithProviders(
    <MessageComposer channelId="ch1" workspaceId="ws1" members={members} onSend={onSend} onTyping={onTyping} {...props} />,
  );
  return { onSend, onTyping, ...utils };
}

describe('MessageComposer', () => {
  it('sends on Enter and clears the input', async () => {
    const user = userEvent.setup();
    const { onSend, onTyping } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'Hello team{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith({ body: 'Hello team', mentions: [], attachmentIds: [], attachments: [] });
    expect(box).toHaveValue('');
    expect(onTyping).toHaveBeenCalled();
  });

  it('inserts a newline on Shift+Enter without sending', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('is disabled with a notice for read-only channels', () => {
    setup({ disabledReason: 'This channel is mirrored from Slack and is read-only.' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/read-only/i);
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument();
  });

  it('filters the mention autocomplete and records the mention on send', async () => {
    const user = userEvent.setup();
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'ping @al');

    const list = screen.getByRole('listbox', { name: 'Mention a member' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Alice Smith'), expect.stringContaining('Alan Turing')]);
    expect(within(list).queryByText('Bob Jones')).not.toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(box).toHaveValue('ping @Alan Turing ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'ping @Alan Turing', mentions: [members[2]?.id] }),
    );
  });
});
