import { expect, test } from '@playwright/test';
import { PASSWORD, uniqueEmail, verifyEmail } from './helpers';

test('sign up, create a workspace, a project and a task', async ({ page, request }) => {
  // Someone else already owns the "acme-inc" slug: the same name must still work.
  const otherEmail = uniqueEmail('other');
  expect((await request.post('/api/auth/register', { data: { name: 'Someone Else', email: otherEmail, password: PASSWORD } })).ok()).toBeTruthy();
  await verifyEmail(otherEmail);
  expect((await request.post('/api/workspaces', { data: { name: 'Acme Inc' } })).ok()).toBeTruthy();

  const email = uniqueEmail('signup');

  await page.goto('/register');
  await page.getByLabel('Full name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  // New accounts land on onboarding; creating things requires a verified email.
  await expect(page).toHaveURL(/\/onboarding/);
  await verifyEmail(email);
  await page.reload();

  await page.getByLabel('Name').fill('Acme Inc');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/w\/[0-9a-f]{24}$/);

  await page.getByRole('button', { name: 'New project' }).first().click();
  const projectDialog = page.getByRole('dialog');
  await projectDialog.getByLabel('Name').fill('Website');
  await projectDialog.getByLabel('Key').fill('SITE');
  await projectDialog.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f]{24}\/board/);

  await page.getByRole('button', { name: 'New task', exact: true }).click();
  const taskDialog = page.getByRole('dialog');
  await taskDialog.getByLabel('Title').fill('Write the launch post');
  await taskDialog.getByRole('button', { name: 'Create task' }).click();

  await expect(page.getByTestId('task-card').filter({ hasText: 'Write the launch post' })).toBeVisible();
  // A new task opens in the detail drawer with its key.
  await expect(page.getByRole('dialog', { name: 'Write the launch post' }).getByText('SITE-1')).toBeVisible();
});

test('sign in with an existing account', async ({ page }) => {
  const email = uniqueEmail('signin');
  const res = await page.request.post('/api/auth/register', { data: { name: 'Grace Hopper', email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  await page.request.post('/api/auth/logout');
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/onboarding/);
});
