import type { ChannelDto, MessageDto, ProjectDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Channel } from '../src/models/Channel';
import { ChannelRead } from '../src/models/ChannelRead';
import { FileModel } from '../src/models/File';
import { Message } from '../src/models/Message';
import { Notification } from '../src/models/Notification';
import { sentEmails } from '../src/services/email';
import { api, createTestUser, type TestUser } from './helpers';

async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutMs = 3000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (pred(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
  expect(res.status).toBe(201);
  const ws = res.body.data as WorkspaceDto;
  await waitFor(() => Channel.exists({ workspaceId: ws.id, slug: 'general' }), (v) => v !== null);
  return ws;
}

async function join(owner: TestUser, wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  const inv = await api()
    .post(`/api/workspaces/${wsId}/invitations`)
    .set('Cookie', owner.cookie)
    .send({ email: user.user.email, role });
  expect(inv.status).toBe(201);
  const mail = [...sentEmails].reverse().find((m) => m.to === user.user.email);
  const token = mail?.html.match(/invite\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error('No invitation token');
  const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', user.cookie);
  expect(accept.status).toBe(200);
  return user;
}

async function createProject(actor: TestUser, wsId: string, body: Record<string, unknown>) {
  const res = await api().post(`/api/workspaces/${wsId}/projects`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  const project = res.body.data as ProjectDto;
  await waitFor(() => Channel.exists({ projectId: project.id }), (v) => v !== null);
  return project;
}

async function listChannels(actor: TestUser, wsId: string): Promise<ChannelDto[]> {
  const res = await api().get(`/api/workspaces/${wsId}/channels`).set('Cookie', actor.cookie);
  expect(res.status).toBe(200);
  return res.body.data as ChannelDto[];
}

async function createChannel(actor: TestUser, wsId: string, body: Record<string, unknown>): Promise<ChannelDto> {
  const res = await api().post(`/api/workspaces/${wsId}/channels`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as ChannelDto;
}

async function send(actor: TestUser, channelId: string, body: Record<string, unknown>): Promise<MessageDto> {
  const res = await api().post(`/api/channels/${channelId}/messages`).set('Cookie', actor.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as MessageDto;
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  ws: WorkspaceDto;
  project: ProjectDto;
  general: ChannelDto;
  projectChannel: ChannelDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser({ name: 'Olivia Owner' });
  const ws = await createWorkspace(owner);
  const member = await join(owner, ws.id, 'MEMBER');
  const project = await createProject(owner, ws.id, { name: 'Web App', key: 'WEB', memberIds: [member.id] });
  const channels = await listChannels(owner, ws.id);
  const general = channels.find((c) => c.slug === 'general');
  const projectChannel = channels.find((c) => c.projectId === project.id);
  if (!general || !projectChannel) throw new Error('System channels missing');
  return { owner, member, ws, project, general, projectChannel };
}

describe('Chat', () => {
  describe('channels', () => {
    it('auto-creates #general and project channels and lists them in order', async () => {
      const { owner, member, ws, project, general, projectChannel } = await fixture();

      expect(general).toMatchObject({ type: 'PUBLIC', name: 'general', isMember: true, memberCount: 2, unreadCount: 0 });
      expect(projectChannel).toMatchObject({ type: 'PUBLIC', name: 'Web App', slug: 'proj-web', projectId: project.id });

      await send(owner, general.id, { body: 'Welcome!' });
      const list = await listChannels(member, ws.id);
      // Project channels first, then by lastMessageAt desc
      expect(list[0]?.id).toBe(projectChannel.id);
      expect(list[1]?.id).toBe(general.id);
      expect(list[1]?.unreadCount).toBe(1);
      expect(list[1]?.lastMessagePreview).toBe('Welcome!');

      const own = await listChannels(owner, ws.id);
      expect(own.find((c) => c.id === general.id)?.unreadCount).toBe(0);
    });

    it('creates channels with unique slugs and enforces private access', async () => {
      const { owner, member, ws } = await fixture();
      const outsider = await join(owner, ws.id, 'MEMBER');

      const design = await createChannel(owner, ws.id, { name: 'Design Team', description: 'Pixels' });
      expect(design).toMatchObject({ type: 'PUBLIC', slug: 'design-team', isMember: true, createdBy: owner.id });
      const design2 = await createChannel(owner, ws.id, { name: 'Design  Team!' });
      expect(design2.slug).toBe('design-team-2');

      const dup = await api().post(`/api/workspaces/${ws.id}/channels`).set('Cookie', owner.cookie).send({ name: 'X Y', slug: 'design-team' });
      expect(dup.status).toBe(409);

      const secret = await createChannel(member, ws.id, { name: 'Secret', type: 'PRIVATE', memberIds: [owner.id] });
      expect(secret).toMatchObject({ type: 'PRIVATE', memberCount: 2, isMember: true, participants: null });

      const visible = await listChannels(outsider, ws.id);
      expect(visible.map((c) => c.id)).not.toContain(secret.id);
      expect(visible.map((c) => c.id)).toContain(design.id);

      const denied = await api().get(`/api/channels/${secret.id}`).set('Cookie', outsider.cookie);
      expect(denied.status).toBe(403);
      const deniedPost = await api().post(`/api/channels/${secret.id}/messages`).set('Cookie', outsider.cookie).send({ body: 'hi' });
      expect(deniedPost.status).toBe(403);

      const stranger = await createTestUser();
      const hidden = await api().get(`/api/channels/${secret.id}`).set('Cookie', stranger.cookie);
      expect(hidden.status).toBe(404);

      const viewer = await join(owner, ws.id, 'VIEWER');
      const noCreate = await api().post(`/api/workspaces/${ws.id}/channels`).set('Cookie', viewer.cookie).send({ name: 'Nope' });
      expect(noCreate.status).toBe(403);
      const noSend = await api().post(`/api/channels/${design.id}/messages`).set('Cookie', viewer.cookie).send({ body: 'hi' });
      expect(noSend.status).toBe(403);

      const badProject = await api()
        .post(`/api/workspaces/${ws.id}/channels`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Orphan', projectId: '64b000000000000000000000' });
      expect(badProject.status).toBe(400);
    });

    it('opens a DM once and names it after the other participant', async () => {
      const { owner, member, ws } = await fixture();

      const first = await api().post(`/api/workspaces/${ws.id}/channels/dm`).set('Cookie', owner.cookie).send({ userId: member.id });
      expect(first.status).toBe(200);
      const dm = first.body.data as ChannelDto;
      expect(dm).toMatchObject({ type: 'DM', name: member.user.name, memberCount: 2, isMember: true });
      expect(dm.participants?.map((p) => p.id)).toEqual([member.id]);

      const again = await api().post(`/api/workspaces/${ws.id}/channels/dm`).set('Cookie', member.cookie).send({ userId: owner.id });
      expect(again.body.data.id).toBe(dm.id);
      expect(again.body.data.name).toBe('Olivia Owner');

      const self = await api().post(`/api/workspaces/${ws.id}/channels/dm`).set('Cookie', owner.cookie).send({ userId: owner.id });
      expect(self.status).toBe(400);

      const edit = await api().patch(`/api/channels/${dm.id}`).set('Cookie', owner.cookie).send({ name: 'Nope' });
      expect(edit.status).toBe(400);
    });

    it('updates, archives and deletes channels with the right permissions', async () => {
      const { owner, member, ws, general, projectChannel } = await fixture();
      const channel = await createChannel(member, ws.id, { name: 'Random' });

      const byOther = await join(owner, ws.id, 'MEMBER');
      const denied = await api().patch(`/api/channels/${channel.id}`).set('Cookie', byOther.cookie).send({ name: 'Hijack' });
      expect(denied.status).toBe(403);

      const byCreator = await api().patch(`/api/channels/${channel.id}`).set('Cookie', member.cookie).send({ name: 'Randomness', description: 'Fun' });
      expect(byCreator.status).toBe(200);
      expect(byCreator.body.data).toMatchObject({ name: 'Randomness', description: 'Fun', slug: 'random' });

      const archived = await api().patch(`/api/channels/${channel.id}`).set('Cookie', owner.cookie).send({ isArchived: true });
      expect(archived.body.data.isArchived).toBe(true);
      const post = await api().post(`/api/channels/${channel.id}/messages`).set('Cookie', owner.cookie).send({ body: 'late' });
      expect(post.status).toBe(403);

      const noDelete = await api().delete(`/api/channels/${channel.id}`).set('Cookie', member.cookie);
      expect(noDelete.status).toBe(403);
      const noGeneral = await api().delete(`/api/channels/${general.id}`).set('Cookie', owner.cookie);
      expect(noGeneral.status).toBe(400);
      const noProject = await api().delete(`/api/channels/${projectChannel.id}`).set('Cookie', owner.cookie);
      expect(noProject.status).toBe(400);

      await api().patch(`/api/channels/${channel.id}`).set('Cookie', owner.cookie).send({ isArchived: false });
      await send(owner, channel.id, { body: 'bye' });
      await api().post(`/api/channels/${channel.id}/read`).set('Cookie', member.cookie).send({});
      const deleted = await api().delete(`/api/channels/${channel.id}`).set('Cookie', owner.cookie);
      expect(deleted.status).toBe(204);
      expect(await Message.countDocuments({ channelId: channel.id })).toBe(0);
      expect(await ChannelRead.countDocuments({ channelId: channel.id })).toBe(0);
      expect(await Channel.findById(channel.id)).toBeNull();
    });

    it('rejects posting to Slack-mirrored read-only channels', async () => {
      const { owner, ws } = await fixture();
      const mirrored = await Channel.create({
        workspaceId: ws.id,
        type: 'PUBLIC',
        name: 'slack-eng',
        slug: 'slack-eng',
        source: 'slack',
        isReadOnly: true,
      });
      const res = await api().post(`/api/channels/${String(mirrored._id)}/messages`).set('Cookie', owner.cookie).send({ body: 'x' });
      expect(res.status).toBe(403);
      const get = await api().get(`/api/channels/${String(mirrored._id)}`).set('Cookie', owner.cookie);
      expect(get.body.data).toMatchObject({ isReadOnly: true, source: 'slack' });
    });

    it('manages members of private channels', async () => {
      const { owner, member, ws } = await fixture();
      const third = await join(owner, ws.id, 'MEMBER');
      const manager = await join(owner, ws.id, 'MANAGER');
      const secret = await createChannel(member, ws.id, { name: 'Secret', type: 'PRIVATE' });
      expect(secret.memberCount).toBe(1);

      const members = await api().get(`/api/channels/${secret.id}/members`).set('Cookie', member.cookie);
      expect(members.body.data).toHaveLength(1);
      expect(members.body.data[0]).toMatchObject({ user: { id: member.id }, role: 'MEMBER' });

      const outsiderAdd = await api().post(`/api/channels/${secret.id}/members`).set('Cookie', third.cookie).send({ userIds: [third.id] });
      expect(outsiderAdd.status).toBe(403);

      const managerAdd = await api().post(`/api/channels/${secret.id}/members`).set('Cookie', manager.cookie).send({ userIds: [third.id] });
      expect(managerAdd.status).toBe(200);
      expect(managerAdd.body.data.memberCount).toBe(2);

      const stranger = await createTestUser();
      const badAdd = await api().post(`/api/channels/${secret.id}/members`).set('Cookie', member.cookie).send({ userIds: [stranger.id] });
      expect(badAdd.status).toBe(400);

      const notAllowedRemove = await api().delete(`/api/channels/${secret.id}/members/${member.id}`).set('Cookie', third.cookie);
      expect(notAllowedRemove.status).toBe(403);
      const leave = await api().delete(`/api/channels/${secret.id}/members/${third.id}`).set('Cookie', third.cookie);
      expect(leave.status).toBe(200);
      expect(leave.body.data).toMatchObject({ memberCount: 1, isMember: false });

      const general = (await listChannels(owner, ws.id)).find((c) => c.slug === 'general');
      const publicAdd = await api().post(`/api/channels/${general?.id}/members`).set('Cookie', owner.cookie).send({ userIds: [third.id] });
      expect(publicAdd.status).toBe(400);
      const publicMembers = await api().get(`/api/channels/${general?.id}/members`).set('Cookie', owner.cookie);
      expect(publicMembers.body.data).toHaveLength(4); // owner, member, third, manager
    });
  });

  describe('messages', () => {
    it('sends, threads, paginates and tracks read state', async () => {
      const { owner, member, ws, general } = await fixture();

      const m1 = await send(owner, general.id, { body: 'First', clientId: 'c-1' });
      expect(m1).toMatchObject({
        channelId: general.id,
        body: 'First',
        clientId: 'c-1',
        author: { id: owner.id },
        parentMessageId: null,
        replyCount: 0,
        reactions: [],
        attachments: [],
        source: 'nexus',
      });
      const m2 = await send(owner, general.id, { body: 'Second' });
      const m3 = await send(member, general.id, { body: 'Third' });

      const reply = await send(member, general.id, { body: 'A reply', parentMessageId: m1.id });
      expect(reply.parentMessageId).toBe(m1.id);
      const nested = await api().post(`/api/channels/${general.id}/messages`).set('Cookie', member.cookie).send({ body: 'x', parentMessageId: reply.id });
      expect(nested.status).toBe(400);

      const parent = await api().get(`/api/messages/${m1.id}`).set('Cookie', owner.cookie);
      expect(parent.body.data).toMatchObject({ replyCount: 1 });
      expect(parent.body.data.lastReplyAt).not.toBeNull();
      const replies = await api().get(`/api/messages/${m1.id}/replies`).set('Cookie', owner.cookie);
      expect(replies.body.data.map((m: MessageDto) => m.id)).toEqual([reply.id]);

      const list = await api().get(`/api/channels/${general.id}/messages`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(list.body.meta).toBeUndefined();
      expect(list.body.data.map((m: MessageDto) => m.id)).toEqual([m3.id, m2.id, m1.id]);

      const page = await api().get(`/api/channels/${general.id}/messages?limit=1&before=${encodeURIComponent(m3.createdAt)}`).set('Cookie', owner.cookie);
      expect(page.body.data.map((m: MessageDto) => m.id)).toEqual([m2.id]);
      const after = await api().get(`/api/channels/${general.id}/messages?after=${encodeURIComponent(m1.createdAt)}`).set('Cookie', owner.cookie);
      expect(after.body.data.map((m: MessageDto) => m.id)).toEqual([m3.id, m2.id]);

      const channel = await api().get(`/api/channels/${general.id}`).set('Cookie', owner.cookie);
      expect(channel.body.data).toMatchObject({ lastMessagePreview: 'Third', unreadCount: 1 });
      const raw = await Channel.findById(general.id).lean();
      expect(raw?.messageCount).toBe(3);

      // Owner sent 2 and read up to their own message; member's reply does not count (thread)
      const memberView = await api().get(`/api/channels/${general.id}`).set('Cookie', member.cookie);
      expect(memberView.body.data.unreadCount).toBe(0);

      const read = await api().post(`/api/channels/${general.id}/read`).set('Cookie', owner.cookie).send({});
      expect(read.body.data).toMatchObject({ channelId: general.id, unreadCount: 0 });
      const rewind = await api().post(`/api/channels/${general.id}/read`).set('Cookie', owner.cookie).send({ messageId: m1.id });
      expect(rewind.body.data).toMatchObject({ unreadCount: 1, lastReadAt: m1.createdAt });

      const unread = await api().get(`/api/workspaces/${ws.id}/unread`).set('Cookie', owner.cookie);
      expect(unread.status).toBe(200);
      expect(unread.body.data.total).toBe(1);
      expect(unread.body.data.channels.find((c: { channelId: string }) => c.channelId === general.id)?.unreadCount).toBe(1);

      const mute = await api().post(`/api/channels/${general.id}/mute`).set('Cookie', member.cookie).send({ muted: true });
      expect(mute.status).toBe(200);
      expect(await ChannelRead.findOne({ channelId: general.id, userId: member.id }).lean()).toMatchObject({ muted: true });
      expect(mute.body.data.muted).toBe(true);

      // Mute state is per viewer and surfaces on the channel and the unread summary
      const memberChannel = await api().get(`/api/channels/${general.id}`).set('Cookie', member.cookie);
      expect(memberChannel.body.data.muted).toBe(true);
      const ownerChannel = await api().get(`/api/channels/${general.id}`).set('Cookie', owner.cookie);
      expect(ownerChannel.body.data.muted).toBe(false);
      const memberUnread = await api().get(`/api/workspaces/${ws.id}/unread`).set('Cookie', member.cookie);
      expect(memberUnread.body.data.channels.find((c: { channelId: string }) => c.channelId === general.id)?.muted).toBe(true);

      const empty = await api().post(`/api/channels/${general.id}/messages`).set('Cookie', owner.cookie).send({ body: '   ' });
      expect(empty.status).toBe(422);
    });

    it('edits, soft-deletes and toggles reactions', async () => {
      const { owner, member, ws, general } = await fixture();
      const manager = await join(owner, ws.id, 'MANAGER');
      const msg = await send(member, general.id, { body: 'Typo' });

      const notAuthor = await api().patch(`/api/messages/${msg.id}`).set('Cookie', owner.cookie).send({ body: 'Fixed' });
      expect(notAuthor.status).toBe(403);
      const edited = await api().patch(`/api/messages/${msg.id}`).set('Cookie', member.cookie).send({ body: 'Fixed' });
      expect(edited.status).toBe(200);
      expect(edited.body.data.body).toBe('Fixed');
      expect(edited.body.data.editedAt).not.toBeNull();
      expect((await Channel.findById(general.id).lean())?.lastMessagePreview).toBe('Fixed');

      const r1 = await api().post(`/api/messages/${msg.id}/reactions`).set('Cookie', owner.cookie).send({ emoji: '👍' });
      expect(r1.body.data.reactions).toEqual([{ emoji: '👍', count: 1, userIds: [owner.id], reacted: true }]);
      const r2 = await api().post(`/api/messages/${msg.id}/reactions`).set('Cookie', member.cookie).send({ emoji: '👍' });
      expect(r2.body.data.reactions[0]).toMatchObject({ count: 2, reacted: true });
      const asOwner = await api().get(`/api/messages/${msg.id}`).set('Cookie', owner.cookie);
      expect(asOwner.body.data.reactions[0].reacted).toBe(true);
      const r3 = await api().post(`/api/messages/${msg.id}/reactions`).set('Cookie', owner.cookie).send({ emoji: '👍' });
      expect(r3.body.data.reactions[0]).toMatchObject({ count: 1, userIds: [member.id], reacted: false });
      const r4 = await api().post(`/api/messages/${msg.id}/reactions`).set('Cookie', member.cookie).send({ emoji: '👍' });
      expect(r4.body.data.reactions).toEqual([]);

      const other = await join(owner, ws.id, 'MEMBER');
      const deniedDelete = await api().delete(`/api/messages/${msg.id}`).set('Cookie', other.cookie);
      expect(deniedDelete.status).toBe(403);
      const byManager = await api().delete(`/api/messages/${msg.id}`).set('Cookie', manager.cookie);
      expect(byManager.status).toBe(200);
      expect(byManager.body.data).toMatchObject({ body: '', attachments: [] });
      expect(byManager.body.data.deletedAt).not.toBeNull();

      const list = await api().get(`/api/channels/${general.id}/messages`).set('Cookie', owner.cookie);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toMatchObject({ id: msg.id, body: '' });

      const editDeleted = await api().patch(`/api/messages/${msg.id}`).set('Cookie', member.cookie).send({ body: 'Zombie' });
      expect(editDeleted.status).toBe(400);
    });

    it('attaches the caller\'s own unattached files and unlinks them on delete', async () => {
      const { owner, member, ws, general } = await fixture();
      const mine = await FileModel.create({
        workspaceId: ws.id, uploadedBy: owner.id, name: 'spec.pdf', mimeType: 'application/pdf', size: 10,
        kind: 'pdf', url: 'http://files/spec.pdf', storageKey: 'k1', provider: 'local',
      });
      const theirs = await FileModel.create({
        workspaceId: ws.id, uploadedBy: member.id, name: 'x.png', mimeType: 'image/png', size: 10,
        kind: 'image', url: 'http://files/x.png', storageKey: 'k2', provider: 'local',
      });

      const bad = await api().post(`/api/channels/${general.id}/messages`).set('Cookie', owner.cookie).send({ body: '', attachmentIds: [String(theirs._id)] });
      expect(bad.status).toBe(400);

      const msg = await send(owner, general.id, { body: '', attachmentIds: [String(mine._id)] });
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]).toMatchObject({ id: String(mine._id), name: 'spec.pdf', kind: 'pdf', uploadedBy: { id: owner.id } });
      const linked = await FileModel.findById(mine._id).lean();
      expect(String(linked?.channelId)).toBe(general.id);
      expect(String(linked?.messageId)).toBe(msg.id);
      expect((await Channel.findById(general.id).lean())?.lastMessagePreview).toBe('Sent an attachment');

      const reuse = await api().post(`/api/channels/${general.id}/messages`).set('Cookie', owner.cookie).send({ body: 'again', attachmentIds: [String(mine._id)] });
      expect(reuse.status).toBe(400);

      await api().delete(`/api/messages/${msg.id}`).set('Cookie', owner.cookie);
      const file = await FileModel.findById(mine._id).lean();
      expect(file?.messageId).toBeNull();
      expect(file?.deletedAt).toBeNull();
    });

    it('filters mentions to workspace members and notifies them', async () => {
      const { owner, member, ws, general } = await fixture();
      const stranger = await createTestUser();

      const msg = await send(owner, general.id, { body: 'Hey @member', mentions: [member.id, stranger.id] });
      expect(msg.mentions).toEqual([member.id]);

      const notif = await waitFor(
        () => Notification.findOne({ userId: member.id, type: 'MENTION' }).lean(),
        (n) => n !== null,
      );
      expect(notif).toMatchObject({ link: `/w/${ws.id}/chat/${general.id}`, body: 'Hey @member' });
      expect(await Notification.countDocuments({ userId: stranger.id })).toBe(0);
    });
  });
});
