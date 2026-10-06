import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileDto, ProjectDto, TaskDto, WorkspaceDto, WorkspaceRole } from '@nexus/shared';
import { ERROR_CODES, MAX_FILE_SIZE_BYTES } from '@nexus/shared';
import { Types } from 'mongoose';
import { env } from '../src/config/env';
import { events } from '../src/events';
import { Activity } from '../src/models/Activity';
import { FileModel } from '../src/models/File';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { api, createTestUser, type TestUser } from './helpers';

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const SVG_OK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const SVG_BAD = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

async function createWorkspace(owner: TestUser, name = 'Acme Inc') {
  const res = await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name });
  expect(res.status).toBe(201);
  return res.body.data as WorkspaceDto;
}

async function addMember(wsId: string, role: WorkspaceRole): Promise<TestUser> {
  const user = await createTestUser();
  await WorkspaceMember.create({ workspaceId: wsId, userId: user.id, role });
  return user;
}

interface Fixture {
  owner: TestUser;
  member: TestUser;
  outsider: TestUser;
  viewer: TestUser;
  ws: WorkspaceDto;
  project: ProjectDto;
  task: TaskDto;
}

async function fixture(): Promise<Fixture> {
  const owner = await createTestUser();
  const ws = await createWorkspace(owner);
  const member = await addMember(ws.id, 'MEMBER');
  const outsider = await addMember(ws.id, 'MEMBER');
  const viewer = await addMember(ws.id, 'VIEWER');
  const projectRes = await api()
    .post(`/api/workspaces/${ws.id}/projects`)
    .set('Cookie', owner.cookie)
    .send({ name: 'Web App', key: 'WEB', memberIds: [member.id] });
  expect(projectRes.status).toBe(201);
  const project = projectRes.body.data as ProjectDto;
  const taskRes = await api().post(`/api/projects/${project.id}/tasks`).set('Cookie', owner.cookie).send({ title: 'Attach things' });
  expect(taskRes.status).toBe(201);
  return { owner, member, outsider, viewer, ws, project, task: taskRes.body.data as TaskDto };
}

function upload(actor: TestUser, wsId: string, buffer: Buffer, filename: string, contentType: string, fields: Record<string, string> = {}) {
  let req = api().post(`/api/workspaces/${wsId}/files`).set('Cookie', actor.cookie);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', buffer, { filename, contentType });
}

describe('Files', () => {
  let tmpDir: string;
  let cwdSpy: jest.SpiedFunction<typeof process.cwd>;
  const wsDir = (wsId: string) => path.join(tmpDir, 'uploads', wsId);
  const filesOnDisk = (wsId: string) => (existsSync(wsDir(wsId)) ? readdirSync(wsDir(wsId)) : []);

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'nexus-files-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  });

  afterAll(() => {
    cwdSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('upload', () => {
    it('stores a PNG on local disk with dimensions, emits file.uploaded and records activity', async () => {
      const { member, ws } = await fixture();
      const emitted: unknown[] = [];
      const off = events.on('file.uploaded', (p) => {
        emitted.push(p);
      });

      const res = await upload(member, ws.id, PNG, 'pixel.png', 'image/png');
      off();
      expect(res.status).toBe(201);
      const file = res.body.data as FileDto;
      expect(file).toMatchObject({
        workspaceId: ws.id,
        projectId: null,
        taskId: null,
        channelId: null,
        documentId: null,
        name: 'pixel.png',
        mimeType: 'image/png',
        size: PNG.length,
        kind: 'image',
        thumbnailUrl: null,
        width: 1,
        height: 1,
      });
      expect(file.uploadedBy.id).toBe(member.id);
      expect(file.url.startsWith(`${env.API_URL}/uploads/${ws.id}/`)).toBe(true);
      expect(file.url.endsWith('.png')).toBe(true);
      expect(filesOnDisk(ws.id)).toEqual([path.basename(file.url)]);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({ actorId: member.id, file: { id: file.id } });
      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'FILE_UPLOADED' }).lean();
      expect(activity?.projectId).toBeNull();
      expect(activity?.metadata).toMatchObject({ fileId: file.id, name: 'pixel.png' });

      const stored = await FileModel.findById(file.id).lean();
      expect(stored?.provider).toBe('local');
      expect(stored?.storageKey).toBe(`${ws.id}/${path.basename(file.url)}`);
    });

    it('attaches a PDF to a task (inheriting the project) and lists it under the task', async () => {
      const { owner, member, outsider, ws, project, task } = await fixture();
      const res = await upload(member, ws.id, PDF, 'Spec Final.pdf', 'application/pdf', { taskId: task.id });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ kind: 'pdf', taskId: task.id, projectId: project.id, name: 'Spec Final.pdf' });

      const activity = await Activity.findOne({ workspaceId: ws.id, type: 'FILE_UPLOADED' }).lean();
      expect(String(activity?.projectId)).toBe(project.id);

      const list = await api().get(`/api/tasks/${task.id}/files`).set('Cookie', owner.cookie);
      expect(list.status).toBe(200);
      expect(list.body.data.map((f: FileDto) => f.id)).toEqual([res.body.data.id]);

      // Members outside the project cannot attach to its tasks nor list them.
      const denied = await upload(outsider, ws.id, PDF, 'x.pdf', 'application/pdf', { taskId: task.id });
      expect(denied.status).toBe(403);
      const deniedList = await api().get(`/api/tasks/${task.id}/files`).set('Cookie', outsider.cookie);
      expect(deniedList.status).toBe(403);

      const mismatch = await upload(owner, ws.id, PDF, 'x.pdf', 'application/pdf', { taskId: task.id, projectId: new Types.ObjectId().toHexString() });
      expect(mismatch.status).toBe(400);
    });

    it('rejects disallowed types, mismatched extensions/bytes and scripted SVGs', async () => {
      const { owner, ws } = await fixture();

      const exe = await upload(owner, ws.id, Buffer.from('MZ\u0000\u0000'), 'setup.exe', 'application/x-msdownload');
      expect(exe.status).toBe(400);
      expect(exe.body.error.code).toBe(ERROR_CODES.BAD_REQUEST);

      const wrongExt = await upload(owner, ws.id, PNG, 'pixel.pdf', 'image/png');
      expect(wrongExt.status).toBe(400);

      const spoofed = await upload(owner, ws.id, Buffer.from('not really a pdf'), 'doc.pdf', 'application/pdf');
      expect(spoofed.status).toBe(400);

      const badSvg = await upload(owner, ws.id, SVG_BAD, 'icon.svg', 'image/svg+xml');
      expect(badSvg.status).toBe(400);
      expect(badSvg.body.error.message).toMatch(/script/i);

      const goodSvg = await upload(owner, ws.id, SVG_OK, 'icon.svg', 'image/svg+xml');
      expect(goodSvg.status).toBe(201);
      expect(goodSvg.body.data.kind).toBe('image');

      const missing = await api().post(`/api/workspaces/${ws.id}/files`).set('Cookie', owner.cookie).field('projectId', 'x');
      expect(missing.status).toBe(400);

      expect(filesOnDisk(ws.id)).toHaveLength(1);
    });

    it('returns 413 for files over MAX_FILE_SIZE_BYTES', async () => {
      const { owner, ws } = await fixture();
      const big = Buffer.concat([PNG, Buffer.alloc(MAX_FILE_SIZE_BYTES - PNG.length + 1)]);
      const res = await upload(owner, ws.id, big, 'huge.png', 'image/png');
      expect(res.status).toBe(413);
      expect(res.body.error.message).toBe('File too large');
      expect(filesOnDisk(ws.id)).toEqual([]);
    });

    it('returns 413 when the workspace quota is exhausted and reports usage', async () => {
      const { owner, viewer, ws } = await fixture();
      await FileModel.create({
        workspaceId: ws.id,
        uploadedBy: owner.id,
        name: 'archive.zip',
        mimeType: 'application/zip',
        size: env.STORAGE_LIMIT_BYTES - 10,
        kind: 'archive',
        url: `${env.API_URL}/uploads/${ws.id}/archive.zip`,
        storageKey: `${ws.id}/archive.zip`,
        provider: 'local',
      });

      const usage = await api().get(`/api/workspaces/${ws.id}/files/usage`).set('Cookie', viewer.cookie);
      expect(usage.status).toBe(200);
      expect(usage.body.data).toEqual({ usedBytes: env.STORAGE_LIMIT_BYTES - 10, limitBytes: env.STORAGE_LIMIT_BYTES, fileCount: 1 });

      const res = await upload(owner, ws.id, PNG, 'pixel.png', 'image/png');
      expect(res.status).toBe(413);
      expect(res.body.error.message).toMatch(/quota/i);
      expect(res.body.error.details).toMatchObject({ limitBytes: env.STORAGE_LIMIT_BYTES });
      expect(filesOnDisk(ws.id)).toEqual([]);
    });

    it('requires file:upload and a verified email', async () => {
      const { viewer, ws } = await fixture();
      const res = await upload(viewer, ws.id, PNG, 'pixel.png', 'image/png');
      expect(res.status).toBe(403);
      const unverified = await createTestUser({ emailVerified: false });
      await WorkspaceMember.create({ workspaceId: ws.id, userId: unverified.id, role: 'MEMBER' });
      const blocked = await upload(unverified, ws.id, PNG, 'pixel.png', 'image/png');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe(ERROR_CODES.EMAIL_NOT_VERIFIED);
    });
  });

  describe('list & get', () => {
    it('filters, sorts and limits restricted roles to accessible projects', async () => {
      const { owner, member, outsider, viewer, ws, project, task } = await fixture();
      const general = (await upload(owner, ws.id, PNG, 'logo.png', 'image/png')).body.data as FileDto;
      const scoped = (await upload(member, ws.id, PDF, 'spec.pdf', 'application/pdf', { taskId: task.id })).body.data as FileDto;

      const all = await api().get(`/api/workspaces/${ws.id}/files`).set('Cookie', owner.cookie);
      expect(all.status).toBe(200);
      expect(all.body.meta.total).toBe(2);
      expect(all.body.data.map((f: FileDto) => f.id).sort()).toEqual([general.id, scoped.id].sort());

      const images = await api().get(`/api/workspaces/${ws.id}/files?kind=image`).set('Cookie', owner.cookie);
      expect(images.body.data.map((f: FileDto) => f.id)).toEqual([general.id]);

      const byProject = await api().get(`/api/workspaces/${ws.id}/files?projectId=${project.id}`).set('Cookie', member.cookie);
      expect(byProject.body.data.map((f: FileDto) => f.id)).toEqual([scoped.id]);

      const byTask = await api().get(`/api/workspaces/${ws.id}/files?taskId=${task.id}`).set('Cookie', owner.cookie);
      expect(byTask.body.data.map((f: FileDto) => f.id)).toEqual([scoped.id]);

      const search = await api().get(`/api/workspaces/${ws.id}/files?search=SPEC`).set('Cookie', owner.cookie);
      expect(search.body.data.map((f: FileDto) => f.id)).toEqual([scoped.id]);

      const byName = await api().get(`/api/workspaces/${ws.id}/files?sort=name&order=asc`).set('Cookie', owner.cookie);
      expect(byName.body.data.map((f: FileDto) => f.name)).toEqual(['logo.png', 'spec.pdf']);

      const restricted = await api().get(`/api/workspaces/${ws.id}/files`).set('Cookie', outsider.cookie);
      expect(restricted.body.data.map((f: FileDto) => f.id)).toEqual([general.id]);
      const deniedProject = await api().get(`/api/workspaces/${ws.id}/files?projectId=${project.id}`).set('Cookie', outsider.cookie);
      expect(deniedProject.status).toBe(403);

      const direct = await api().get(`/api/files/${scoped.id}`).set('Cookie', viewer.cookie);
      expect(direct.status).toBe(403);
      const visible = await api().get(`/api/files/${general.id}`).set('Cookie', viewer.cookie);
      expect(visible.status).toBe(200);
      expect(visible.body.data.id).toBe(general.id);

      const stranger = await createTestUser();
      expect((await api().get(`/api/files/${general.id}`).set('Cookie', stranger.cookie)).status).toBe(403);
      expect((await api().get(`/api/workspaces/${ws.id}/files`).set('Cookie', stranger.cookie)).status).toBe(403);
    });
  });

  describe('rename & delete', () => {
    it('renames keeping the extension, for the uploader or file:delete holders', async () => {
      const { owner, member, outsider, ws } = await fixture();
      const file = (await upload(member, ws.id, PDF, 'draft.pdf', 'application/pdf')).body.data as FileDto;

      const renamed = await api().patch(`/api/files/${file.id}`).set('Cookie', member.cookie).send({ name: 'Final report' });
      expect(renamed.status).toBe(200);
      expect(renamed.body.data.name).toBe('Final report.pdf');

      const swapped = await api().patch(`/api/files/${file.id}`).set('Cookie', owner.cookie).send({ name: 'report.txt' });
      expect(swapped.body.data.name).toBe('report.pdf');

      const forbidden = await api().patch(`/api/files/${file.id}`).set('Cookie', outsider.cookie).send({ name: 'hijack' });
      expect(forbidden.status).toBe(403);

      const invalid = await api().patch(`/api/files/${file.id}`).set('Cookie', member.cookie).send({ name: '' });
      expect(invalid.status).toBe(422);
    });

    it('soft-deletes, removes the stored object and hides the file afterwards', async () => {
      const { owner, member, outsider, ws } = await fixture();
      const mine = (await upload(member, ws.id, PNG, 'a.png', 'image/png')).body.data as FileDto;
      const other = (await upload(member, ws.id, PNG, 'b.png', 'image/png')).body.data as FileDto;
      expect(filesOnDisk(ws.id)).toHaveLength(2);

      const forbidden = await api().delete(`/api/files/${mine.id}`).set('Cookie', outsider.cookie);
      expect(forbidden.status).toBe(403);

      const own = await api().delete(`/api/files/${mine.id}`).set('Cookie', member.cookie);
      expect(own.status).toBe(204);
      const asOwner = await api().delete(`/api/files/${other.id}`).set('Cookie', owner.cookie);
      expect(asOwner.status).toBe(204);

      expect(filesOnDisk(ws.id)).toEqual([]);
      const stored = await FileModel.findById(mine.id).lean();
      expect(stored?.deletedAt).toBeInstanceOf(Date);

      const gone = await api().get(`/api/files/${mine.id}`).set('Cookie', member.cookie);
      expect(gone.status).toBe(404);
      const list = await api().get(`/api/workspaces/${ws.id}/files`).set('Cookie', owner.cookie);
      expect(list.body.data).toEqual([]);
      const usage = await api().get(`/api/workspaces/${ws.id}/files/usage`).set('Cookie', owner.cookie);
      expect(usage.body.data).toMatchObject({ usedBytes: 0, fileCount: 0 });
      expect(await Activity.countDocuments({ workspaceId: ws.id, type: 'FILE_DELETED' })).toBe(2);
    });
  });
});
