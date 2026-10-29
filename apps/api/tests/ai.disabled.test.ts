import './ai.disabled.env';
import type { WorkspaceDto } from '@nexus/shared';
import { features } from '../src/config/env';
import { api, createTestUser } from './helpers';

/** No ANTHROPIC_API_KEY in this file's environment: AI endpoints answer 503, status still works. */
describe('AI not configured', () => {
  it('returns 503 AI_NOT_CONFIGURED except for /ai/status, and saves meetings as FAILED', async () => {
    expect(features.ai).toBe(false);
    const owner = await createTestUser();
    const ws = (await api().post('/api/workspaces').set('Cookie', owner.cookie).send({ name: 'Acme' })).body.data as WorkspaceDto;

    const status = await api().get('/api/ai/status').set('Cookie', owner.cookie);
    expect(status.body.data.enabled).toBe(false);

    const list = await api().get(`/api/ai/workspaces/${ws.id}/conversations`).set('Cookie', owner.cookie);
    expect(list.status).toBe(503);
    expect(list.body.error.code).toBe('AI_NOT_CONFIGURED');

    const meeting = await api()
      .post(`/api/meetings/workspaces/${ws.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Sync', transcript: 'Alice: hello there, this is a long enough transcript.' });
    expect(meeting.status).toBe(201);
    expect(meeting.body.data).toMatchObject({ status: 'FAILED', error: 'AI is not configured' });

    const analyze = await api().post(`/api/meetings/${meeting.body.data.id}/analyze`).set('Cookie', owner.cookie);
    expect(analyze.status).toBe(503);
  });
});
