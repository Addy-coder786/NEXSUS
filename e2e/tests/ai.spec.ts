import { expect, test } from '@playwright/test';
import { createTask, seedWorkspace } from './helpers';

/**
 * AI flows through the real SDK against the mock Anthropic API (e2e/mock-anthropic.mjs): it asks
 * for list_tasks, then answers from the tool result, so answers contain real task keys.
 */

test('the assistant streams an answer grounded in workspace tasks', async ({ page }) => {
  const seed = await seedWorkspace(page);
  const task = await createTask(page, seed.projectId, 'Fix the login redirect');

  await page.goto(`/w/${seed.workspaceId}/assistant`);
  await page.getByLabel('Message the assistant').fill('What is open right now?');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/assistant\/[0-9a-f]{24}$/);
  await expect(page.getByText(`${task.key}`, { exact: true })).toBeVisible();
  await expect(page.getByText('Fix the login redirect').first()).toBeVisible();
  // The tool call and its source chip link back to the task.
  await expect(page.getByRole('button', { name: /Looked at 1 source/ })).toBeVisible();
  await expect(page.getByRole('link', { name: `${task.key} Fix the login redirect` })).toHaveAttribute(
    'href',
    `/w/${seed.workspaceId}/projects/${seed.projectId}/board?task=${task.id}`,
  );
  // The conversation is listed and titled from the question.
  await expect(page.getByRole('navigation').getByText('What is open right now?')).toBeVisible();
});

test('generate tasks with AI from the board, review and create them', async ({ page }) => {
  const seed = await seedWorkspace(page);
  await page.goto(`/w/${seed.workspaceId}/projects/${seed.projectId}/board`);

  await page.getByRole('button', { name: 'Generate with AI' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What needs to be built?').fill('We need a checkout flow with card payments.');
  await dialog.getByRole('button', { name: 'Generate' }).click();

  await expect(dialog.getByText('Checkout flow')).toBeVisible();
  await expect(dialog.getByLabel('Task title')).toHaveCount(2);
  await dialog.getByLabel('Task title').first().fill('Design the checkout API v1');
  await dialog.getByRole('button', { name: 'Create 2 tasks' }).click();

  await expect(page.getByTestId('task-card').filter({ hasText: 'Design the checkout API v1' })).toBeVisible();
  await expect(page.getByTestId('task-card').filter({ hasText: 'Build the payment form' })).toBeVisible();
});

test('analyse meeting notes and turn an action item into a task', async ({ page }) => {
  const seed = await seedWorkspace(page);
  await page.goto(`/w/${seed.workspaceId}/meetings`);

  await page.getByRole('button', { name: 'New meeting' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill('Beta sync');
  await dialog.getByLabel('Transcript or notes').fill('Olivia: We ship the beta on Friday.\nMaya: I will fix the login redirect by Thursday.');
  await dialog.getByRole('button', { name: 'Save and analyse' }).click();

  await expect(page).toHaveURL(/\/meetings\/[0-9a-f]{24}$/);
  await expect(page.getByText('The team agreed to ship the beta on Friday.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Ship the beta on Friday', { exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: 'Project for new tasks' }).click();
  await page.getByRole('option', { name: 'Web App' }).click();
  await page.getByRole('button', { name: 'Create 1 task' }).click();
  await expect(page.getByRole('link', { name: 'Fix the login redirect' })).toBeVisible();

  await page.goto(`/w/${seed.workspaceId}/projects/${seed.projectId}/board`);
  await expect(page.getByTestId('task-card').filter({ hasText: 'Fix the login redirect' })).toBeVisible();
});

test('AI usage is visible to workspace owners', async ({ page }) => {
  const seed = await seedWorkspace(page);
  const doc = await page.request.post(`/api/workspaces/${seed.workspaceId}/documents`, { data: { title: 'Spec' } });
  const docId = ((await doc.json()) as { data: { id: string } }).data.id;
  expect((await page.request.post(`/api/ai/documents/${docId}/summarize`, { data: {} })).ok()).toBeTruthy();

  await page.goto(`/w/${seed.workspaceId}/settings?tab=ai`);
  await expect(page.getByText('Document summaries')).toBeVisible();
  await expect(page.getByText('Requests today')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rebuild search index' })).toBeVisible();
});
