import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { STACK_FILE } from '../ports.mjs';

let counter = 0;
export const PASSWORD = 'Password123!';

export function uniqueEmail(prefix = 'user'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@e2e.test`;
}

/** Marks an account verified directly in MongoDB (emails are not delivered in e2e). */
export async function verifyEmail(email: string): Promise<void> {
  const { mongoUri } = JSON.parse(readFileSync(STACK_FILE, 'utf8')) as { mongoUri: string };
  const client = await MongoClient.connect(mongoUri);
  try {
    await client.db().collection('users').updateOne({ email }, { $set: { emailVerified: true } });
  } finally {
    await client.close();
  }
}

async function json<T>(res: Awaited<ReturnType<Page['request']['post']>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { data: T }).data;
}

export interface Seed {
  email: string;
  workspaceId: string;
  projectId: string;
  projectKey: string;
}

/**
 * Signs up a verified user in this page's browser context (cookies are shared with
 * page.request), and creates a workspace with one project.
 */
export async function seedWorkspace(page: Page, name = 'E2E User'): Promise<Seed> {
  const email = uniqueEmail();
  await json(await page.request.post('/api/auth/register', { data: { name, email, password: PASSWORD } }));
  await verifyEmail(email);
  const ws = await json<{ id: string }>(await page.request.post('/api/workspaces', { data: { name: 'Acme' } }));
  const project = await json<{ id: string; key: string }>(
    await page.request.post(`/api/workspaces/${ws.id}/projects`, { data: { name: 'Web App', key: 'WEB' } }),
  );
  return { email, workspaceId: ws.id, projectId: project.id, projectKey: project.key };
}

export async function createTask(page: Page, projectId: string, title: string): Promise<{ id: string; key: string }> {
  return json(await page.request.post(`/api/projects/${projectId}/tasks`, { data: { title } }));
}
