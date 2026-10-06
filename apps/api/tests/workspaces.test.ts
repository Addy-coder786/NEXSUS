import type { WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { Activity } from '../src/models/Activity';
import { Invitation } from '../src/models/Invitation';
import { Project } from '../src/models/Project';
import { Task } from '../src/models/Task';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { sentEmails } from '../src/services/email';
import { api, createTestUser, type TestUser } from './helpers';

async function createWorkspace(owner: TestUser, body: Record<string, unknown> = { name: 'Acme Inc' }) {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send(body);
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

function lastInviteToken(email: string): string {
  const mail = [...sentEmails].reverse().find((m) => m.to === email.toLowerCase());
  if (!mail) throw new Error(`No invitation email for ${email}`);
  const match = mail.html.match(/invite\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('No token in invitation email');
  return match[1];
}

async function invite(owner: TestUser, wsId: string, email: string, role: WorkspaceRole) {
  return api()
    .post(`/api/workspaces/${wsId}/invitations`)
    .set('Cookie', owner.cookie)
    .send({ email, role });
}

async function join(owner: TestUser, wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  const inv = await invite(owner, wsId, user.user.email, role);
  expect(inv.status).toBe(201);
  const token = lastInviteToken(user.user.email);
  const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', user.cookie);
  expect(accept.status).toBe(200);
  return user;
}

describe('Workspaces', () => {
  describe('CRUD and slugs', () => {
    it('creates a workspace, makes the creator OWNER and generates a slug', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner, { name: 'Acme Inc', description: 'Rockets' });

      expect(ws.slug).toBe('acme-inc');
      expect(ws.myRole).toBe('OWNER');
      expect(ws.memberCount).toBe(1);
      expect(ws.ownerId).toBe(owner.id);
      expect(ws.description).toBe('Rockets');

      const member = await WorkspaceMember.findOne({ workspaceId: ws.id, userId: owner.id }).lean();
      expect(member?.role).toBe('OWNER');

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'WORKSPACE_CREATED' }).sort({ _id: 1 }).lean();
      expect(activity).not.toBeNull();
    });

    it('appends -2, -3 to taken slugs and strips non-alphanumerics', async () => {
      const owner = await createTestUser();
      const a = await createWorkspace(owner, { name: 'My  Team!!' });
      const b = await createWorkspace(owner, { name: 'My Team' });
      const c = await createWorkspace(owner, { name: 'my-team' });
      expect(a.slug).toBe('my-team');
      expect(b.slug).toBe('my-team-2');
      expect(c.slug).toBe('my-team-3');
    });

    it('rejects an explicit slug that is already taken', async () => {
      const owner = await createTestUser();
      await createWorkspace(owner, { name: 'One', slug: 'custom-slug' });
      const res = await api()
        .post('/api/workspaces')
        .set('Cookie', owner.cookie)
        .send({ name: 'Two', slug: 'custom-slug' });
      expect(res.status).toBe(409);
    });

    it('validates the body', async () => {
      const owner = await createTestUser();
      const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'x' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('requires authentication', async () => {
      const res = await api().get('/api/workspaces');
      expect(res.status).toBe(401);
    });

    it('lists only workspaces the caller belongs to, with role and member count', async () => {
      const owner = await createTestUser();
      const other = await createTestUser();
      const ws = await createWorkspace(owner, { name: 'Shared' });
      await createWorkspace(other, { name: 'Private' });
      const member = await join(owner, ws.id, 'MEMBER');

      const res = await api().get('/api/workspaces').set('Cookie', member.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ id: ws.id, myRole: 'MEMBER', memberCount: 2 });
    });

    it('gets a workspace for members, 403 for non-members and 404 for unknown ids', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const ws = await createWorkspace(owner);

      const ok = await api().get(`/api/workspaces/${ws.id}`).set('Cookie', owner.cookie);
      expect(ok.status).toBe(200);
      expect(ok.body.data.myRole).toBe('OWNER');

      const forbidden = await api().get(`/api/workspaces/${ws.id}`).set('Cookie', stranger.cookie);
      expect(forbidden.status).toBe(403);

      const missing = await api()
        .get('/api/workspaces/64b000000000000000000000')
        .set('Cookie', owner.cookie);
      expect(missing.status).toBe(404);
    });

    it('updates a workspace (OWNER/ADMIN) and records WORKSPACE_UPDATED', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');
      const member = await join(owner, ws.id, 'MEMBER');

      const res = await api()
        .patch(`/api/workspaces/${ws.id}`)
        .set('Cookie', admin.cookie)
        .send({ name: 'Renamed', logoUrl: 'https://cdn.example.com/logo.png' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Renamed');
      expect(res.body.data.logoUrl).toBe('https://cdn.example.com/logo.png');
      expect(res.body.data.myRole).toBe('ADMIN');

      const denied = await api()
        .patch(`/api/workspaces/${ws.id}`)
        .set('Cookie', member.cookie)
        .send({ name: 'Nope' });
      expect(denied.status).toBe(403);

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'WORKSPACE_UPDATED' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ fields: ['name', 'logoUrl'] });
    });

    it('deletes a workspace (OWNER only) and cascades everything', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');
      await invite(owner, ws.id, 'pending@test.dev', 'MEMBER');

      const project = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Proj' });
      expect(project.status).toBe(201);
      const task = await api()
        .post(`/api/projects/${project.body.data.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'T' });
      expect(task.status).toBe(201);

      const denied = await api().delete(`/api/workspaces/${ws.id}`).set('Cookie', admin.cookie);
      expect(denied.status).toBe(403);

      const res = await api().delete(`/api/workspaces/${ws.id}`).set('Cookie', owner.cookie);
      expect(res.status).toBe(204);

      expect(await WorkspaceMember.countDocuments({ workspaceId: ws.id })).toBe(0);
      expect(await Invitation.countDocuments({ workspaceId: ws.id })).toBe(0);
      expect(await Project.countDocuments({ workspaceId: ws.id })).toBe(0);
      expect(await Task.countDocuments({ workspaceId: ws.id })).toBe(0);
      expect(await Activity.countDocuments({ workspaceId: ws.id })).toBe(0);

      const gone = await api().get(`/api/workspaces/${ws.id}`).set('Cookie', owner.cookie);
      expect(gone.status).toBe(404);
    });
  });

  describe('Ownership transfer', () => {
    it('makes the target OWNER and the previous owner ADMIN', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');

      const res = await api()
        .post(`/api/workspaces/${ws.id}/transfer`)
        .set('Cookie', owner.cookie)
        .send({ userId: member.id });
      expect(res.status).toBe(200);
      expect(res.body.data.ownerId).toBe(member.id);
      expect(res.body.data.myRole).toBe('ADMIN');

      const asNewOwner = await api().get(`/api/workspaces/${ws.id}`).set('Cookie', member.cookie);
      expect(asNewOwner.body.data.myRole).toBe('OWNER');

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'MEMBER_ROLE_CHANGED' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ from: 'MEMBER', to: 'OWNER' });
    });

    it('rejects non-members and non-owners', async () => {
      const owner = await createTestUser();
      const stranger = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');

      const notMember = await api()
        .post(`/api/workspaces/${ws.id}/transfer`)
        .set('Cookie', owner.cookie)
        .send({ userId: stranger.id });
      expect(notMember.status).toBe(404);

      const notOwner = await api()
        .post(`/api/workspaces/${ws.id}/transfer`)
        .set('Cookie', admin.cookie)
        .send({ userId: admin.id });
      expect(notOwner.status).toBe(403);
    });
  });

  describe('Members', () => {
    it('lists members with their user and role, and filters by search', async () => {
      const owner = await createTestUser({ name: 'Alice Owner' });
      const ws = await createWorkspace(owner);
      const viewer = await join(owner, ws.id, 'VIEWER');

      const res = await api().get(`/api/workspaces/${ws.id}/members`).set('Cookie', viewer.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toMatchObject({ role: 'OWNER', user: { id: owner.id, name: 'Alice Owner' } });
      expect(res.body.data[0].joinedAt).toBeDefined();

      const search = await api()
        .get(`/api/workspaces/${ws.id}/members?search=alice`)
        .set('Cookie', viewer.cookie);
      expect(search.body.data).toHaveLength(1);
      expect(search.body.data[0].user.id).toBe(owner.id);
    });

    it('ADMIN can change lower roles but not promote to OWNER or touch the OWNER', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');
      const member = await join(owner, ws.id, 'MEMBER');

      const promote = await api()
        .patch(`/api/workspaces/${ws.id}/members/${member.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'MANAGER' });
      expect(promote.status).toBe(200);
      expect(promote.body.data).toMatchObject({ role: 'MANAGER', user: { id: member.id } });

      const toOwner = await api()
        .patch(`/api/workspaces/${ws.id}/members/${member.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'OWNER' });
      expect(toOwner.status).toBe(422);

      const demoteOwner = await api()
        .patch(`/api/workspaces/${ws.id}/members/${owner.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'MEMBER' });
      expect(demoteOwner.status).toBe(403);

      const toAdmin = await api()
        .patch(`/api/workspaces/${ws.id}/members/${member.id}`)
        .set('Cookie', admin.cookie)
        .send({ role: 'ADMIN' });
      expect(toAdmin.status).toBe(403);

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'MEMBER_ROLE_CHANGED' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ userId: member.id, from: 'MEMBER', to: 'MANAGER' });
    });

    it('ADMIN cannot change or remove another ADMIN; MEMBER cannot manage at all', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin1 = await join(owner, ws.id, 'ADMIN');
      const admin2 = await join(owner, ws.id, 'ADMIN');
      const member = await join(owner, ws.id, 'MEMBER');
      const viewer = await join(owner, ws.id, 'VIEWER');

      const peer = await api()
        .patch(`/api/workspaces/${ws.id}/members/${admin2.id}`)
        .set('Cookie', admin1.cookie)
        .send({ role: 'MEMBER' });
      expect(peer.status).toBe(403);

      const removePeer = await api()
        .delete(`/api/workspaces/${ws.id}/members/${admin2.id}`)
        .set('Cookie', admin1.cookie);
      expect(removePeer.status).toBe(403);

      const byMember = await api()
        .patch(`/api/workspaces/${ws.id}/members/${viewer.id}`)
        .set('Cookie', member.cookie)
        .send({ role: 'MEMBER' });
      expect(byMember.status).toBe(403);

      const removeByMember = await api()
        .delete(`/api/workspaces/${ws.id}/members/${viewer.id}`)
        .set('Cookie', member.cookie);
      expect(removeByMember.status).toBe(403);

      const unknown = await api()
        .patch(`/api/workspaces/${ws.id}/members/64b000000000000000000000`)
        .set('Cookie', owner.cookie)
        .send({ role: 'MEMBER' });
      expect(unknown.status).toBe(404);
    });

    it('removes a member, cleans up project memberships and task assignments', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');

      const project = await api()
        .post(`/api/workspaces/${ws.id}/projects`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Proj', memberIds: [member.id] });
      expect(project.status).toBe(201);
      const task = await api()
        .post(`/api/projects/${project.body.data.id}/tasks`)
        .set('Cookie', owner.cookie)
        .send({ title: 'Assigned', assigneeId: member.id });
      expect(task.status).toBe(201);
      expect(task.body.data.assignee.id).toBe(member.id);

      const res = await api()
        .delete(`/api/workspaces/${ws.id}/members/${member.id}`)
        .set('Cookie', owner.cookie);
      expect(res.status).toBe(204);

      const projectAfter = await Project.findById(project.body.data.id).lean();
      expect(projectAfter?.memberIds.map(String)).toEqual([owner.id]);
      const taskAfter = await Task.findById(task.body.data.id).lean();
      expect(taskAfter?.assigneeId).toBeNull();

      const gone = await api().get(`/api/workspaces/${ws.id}`).set('Cookie', member.cookie);
      expect(gone.status).toBe(403);

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'MEMBER_REMOVED' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ userId: member.id, left: false });
    });

    it('lets a non-owner leave, but the OWNER cannot leave', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const viewer = await join(owner, ws.id, 'VIEWER');

      const leave = await api()
        .delete(`/api/workspaces/${ws.id}/members/${viewer.id}`)
        .set('Cookie', viewer.cookie);
      expect(leave.status).toBe(204);

      const list = await api().get('/api/workspaces').set('Cookie', viewer.cookie);
      expect(list.body.data).toHaveLength(0);

      const ownerLeave = await api()
        .delete(`/api/workspaces/${ws.id}/members/${owner.id}`)
        .set('Cookie', owner.cookie);
      expect(ownerLeave.status).toBe(403);
    });
  });

  describe('Invitations', () => {
    it('sends an email with the invite link and lists pending invitations', async () => {
      const owner = await createTestUser({ name: 'Inviter' });
      const ws = await createWorkspace(owner, { name: 'Invite Co' });

      const res = await invite(owner, ws.id, 'Guest@Example.com', 'MANAGER');
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        email: 'guest@example.com',
        role: 'MANAGER',
        status: 'PENDING',
        invitedBy: { id: owner.id, name: 'Inviter' },
      });

      const mail = sentEmails.find((m) => m.to === 'guest@example.com');
      expect(mail).toBeDefined();
      expect(mail?.subject).toContain('Invite Co');
      expect(mail?.html).toMatch(/http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]+/);

      const list = await api().get(`/api/workspaces/${ws.id}/invitations`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(res.body.data.id);

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'INVITATION_SENT' }).sort({ _id: 1 }).lean();
      expect(activity?.metadata).toMatchObject({ email: 'guest@example.com', role: 'MANAGER' });
    });

    it('previews publicly, rejects acceptance by a different email, accepts with the right one', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner, { name: 'Preview Co' });
      const invitee = await createTestUser();
      const impostor = await createTestUser();

      await invite(owner, ws.id, invitee.user.email, 'MEMBER');
      const token = lastInviteToken(invitee.user.email);

      const preview = await api().get(`/api/invitations/${token}`);
      expect(preview.status).toBe(200);
      expect(preview.body.data).toMatchObject({
        workspace: { id: ws.id, name: 'Preview Co', slug: 'preview-co' },
        email: invitee.user.email,
        role: 'MEMBER',
        status: 'PENDING',
      });
      expect(preview.body.data.invitedBy.name).toBe(owner.user.name);

      const wrong = await api().post(`/api/invitations/${token}/accept`).set('Cookie', impostor.cookie);
      expect(wrong.status).toBe(403);

      const anon = await api().post(`/api/invitations/${token}/accept`);
      expect(anon.status).toBe(401);

      const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', invitee.cookie);
      expect(accept.status).toBe(200);
      expect(accept.body.data).toMatchObject({ id: ws.id, myRole: 'MEMBER', memberCount: 2 });

      const again = await api().post(`/api/invitations/${token}/accept`).set('Cookie', invitee.cookie);
      expect(again.status).toBe(409);

      const previewAfter = await api().get(`/api/invitations/${token}`);
      expect(previewAfter.body.data.status).toBe('ACCEPTED');

      const joined = await Activity.findOne({ workspaceId: ws.id, type: 'MEMBER_JOINED' }).sort({ _id: 1 }).lean();
      expect(String(joined?.actorId)).toBe(invitee.id);

      const unknown = await api().get('/api/invitations/not-a-real-token');
      expect(unknown.status).toBe(404);
    });

    it('returns 409 for duplicate pending invites and for existing members', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const member = await join(owner, ws.id, 'MEMBER');

      const first = await invite(owner, ws.id, 'dup@test.dev', 'MEMBER');
      expect(first.status).toBe(201);
      const second = await invite(owner, ws.id, 'DUP@test.dev', 'VIEWER');
      expect(second.status).toBe(409);

      const existing = await invite(owner, ws.id, member.user.email, 'MEMBER');
      expect(existing.status).toBe(409);
    });

    it('revokes invitations; revoked tokens cannot be accepted', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const invitee = await createTestUser();

      const created = await invite(owner, ws.id, invitee.user.email, 'MEMBER');
      const token = lastInviteToken(invitee.user.email);

      const revoke = await api()
        .delete(`/api/workspaces/${ws.id}/invitations/${created.body.data.id}`)
        .set('Cookie', owner.cookie);
      expect(revoke.status).toBe(204);

      const list = await api().get(`/api/workspaces/${ws.id}/invitations`).set('Cookie', owner.cookie);
      expect(list.body.data).toHaveLength(0);

      const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', invitee.cookie);
      expect(accept.status).toBe(404);

      const revokeAgain = await api()
        .delete(`/api/workspaces/${ws.id}/invitations/${created.body.data.id}`)
        .set('Cookie', owner.cookie);
      expect(revokeAgain.status).toBe(404);

      // Re-inviting after revoke is allowed
      const reinvite = await invite(owner, ws.id, invitee.user.email, 'MEMBER');
      expect(reinvite.status).toBe(201);
    });

    it('returns 410 for expired invitations', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const invitee = await createTestUser();

      const created = await invite(owner, ws.id, invitee.user.email, 'MEMBER');
      const token = lastInviteToken(invitee.user.email);
      await Invitation.updateOne(
        { _id: created.body.data.id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

      const preview = await api().get(`/api/invitations/${token}`);
      expect(preview.body.data.status).toBe('EXPIRED');

      const accept = await api().post(`/api/invitations/${token}/accept`).set('Cookie', invitee.cookie);
      expect(accept.status).toBe(410);

      const list = await api().get(`/api/workspaces/${ws.id}/invitations`).set('Cookie', owner.cookie);
      expect(list.body.data).toHaveLength(0);
    });

    it('enforces member:invite and canAssignRole', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      const admin = await join(owner, ws.id, 'ADMIN');
      const manager = await join(owner, ws.id, 'MANAGER');

      const byManager = await invite(manager, ws.id, 'a@test.dev', 'MEMBER');
      expect(byManager.status).toBe(403);

      const adminAsAdmin = await invite(admin, ws.id, 'b@test.dev', 'ADMIN');
      expect(adminAsAdmin.status).toBe(403);

      const adminAsManager = await invite(admin, ws.id, 'c@test.dev', 'MANAGER');
      expect(adminAsManager.status).toBe(201);

      const asOwner = await invite(owner, ws.id, 'd@test.dev', 'OWNER');
      expect(asOwner.status).toBe(422);

      const listByManager = await api()
        .get(`/api/workspaces/${ws.id}/invitations`)
        .set('Cookie', manager.cookie);
      expect(listByManager.status).toBe(403);
    });
  });

  describe('Workspace activity feed', () => {
    it('lists activities newest first with pagination and type filter', async () => {
      const owner = await createTestUser();
      const ws = await createWorkspace(owner);
      await join(owner, ws.id, 'MEMBER');
      await join(owner, ws.id, 'VIEWER');

      const res = await api()
        .get(`/api/workspaces/${ws.id}/activities?limit=2&page=1`)
        .set('Cookie', owner.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(res.body.meta.total).toBeGreaterThanOrEqual(5);
      expect(res.body.data[0].actor.id).toBeDefined();
      const times = res.body.data.map((a: { createdAt: string }) => a.createdAt);
      expect(times[0] >= times[1]).toBe(true);

      const filtered = await api()
        .get(`/api/workspaces/${ws.id}/activities?type=MEMBER_JOINED`)
        .set('Cookie', owner.cookie);
      expect(filtered.body.data).toHaveLength(2);
      expect(filtered.body.data.every((a: { type: string }) => a.type === 'MEMBER_JOINED')).toBe(true);
    });
  });
});
