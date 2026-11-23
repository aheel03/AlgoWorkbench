import { test, expect } from '@playwright/test';

async function signedIn(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), btoa(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', exp, role: 'authenticated' })), 'test-signature'].join('.');
    const session = { access_token: token, refresh_token: 'test-refresh-token', token_type: 'bearer', expires_at: exp, expires_in: 3600, user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'player@example.com', created_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: { username: 'pixel_player' } } };
    localStorage.setItem('sb-hlgkzndgvyumoxnsaozl-auth-token', JSON.stringify(session));
  });
}

test('guest can edit, navigate, and open accessible authentication', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next accepted solution.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ide-desktop.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Custom input' }).fill('3\n10 20 30');
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create your account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: /Stress Lab/ }).click();
  await expect(page.getByRole('heading', { name: 'Break it before the judge does.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/stress-desktop.png', fullPage: true });
  await page.getByRole('button', { name: /My solutions/ }).click();
  await expect(page.getByRole('heading', { name: 'Make yourself at home.' })).toBeVisible();
  await page.getByRole('button', { name: /Online IDE/ }).click();
  await expect(page.getByRole('textbox', { name: 'Custom input' })).toHaveValue('3\n10 20 30');
});

test('mobile layout stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your next accepted solution.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ide-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: /Stress Lab/ }).click();
  await expect(page.getByRole('heading', { name: 'Break it before the judge does.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('sign-up submits user details and explains email confirmation', async ({ page }) => {
  await page.route('**/auth/v1/signup*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'test-user', aud: 'authenticated', email: 'test@example.com', identities: [{ id: 'identity' }], user_metadata: { username: 'test_player' } }) }));
  await page.goto('/');
  await page.getByRole('button', { name: /Sign in.*Sign up/ }).click();
  await page.getByLabel('Username', { exact: true }).fill('test_player');
  await page.getByLabel('Email address').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('TestPassword_2026!');
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page.getByRole('status')).toContainText('Check your inbox');
});

test('signed-in IDE sends custom input and displays compiler results', async ({ page }) => {
  await signedIn(page);
  await page.route('**/api/run', async route => {
    const body = route.request().postDataJSON();
    expect(body.input).toBe('2\n7 8'); expect(route.request().headers().authorization).toContain('Bearer ');
    await route.fulfill({ json: { output: '15\n', error: '', status: 'success', exitCode: 0, time: 0.012, memory: 2048, truncated: false } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /pixel_player/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Custom input' }).fill('2\n7 8');
  await page.getByRole('button', { name: 'Run code', exact: true }).click();
  await expect(page.getByText('Process finished successfully')).toBeVisible();
  await expect(page.locator('.output-body pre')).toHaveText('15\n');
  await expect(page.getByText('12 ms', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save solution', exact: true }).first().click();
  const name = page.getByRole('textbox', { name: 'Solution name' });
  await name.fill('');
  await name.pressSequentially('my_array_solution');
  await expect(name).toHaveValue('my_array_solution');
  await expect(name).toBeFocused();
});

test('stress counterexample survives navigation and browser refresh', async ({ page }) => {
  await signedIn(page);
  const initial = { id: 'test-job', status: 'running', completed: 0, total: 10, seed: 42, startedAt: Date.now(), logs: [], counterexample: null, error: null };
  const finished = { ...initial, status: 'mismatch', completed: 1, finishedAt: Date.now() + 1200, logs: [{ iteration: 1, matches: false, bruteTime: 0.01, optimizedTime: 0.02 }], counterexample: { iteration: 1, input: '2\n7 8\n', brute: { output: '15', error: '', exitCode: 0 }, optimized: { output: '14', error: '', exitCode: 0 } } };
  await page.route('**/api/stress', route => route.fulfill({ status: 202, json: initial }));
  await page.route('**/api/stress/test-job', route => route.fulfill({ json: finished }));
  await page.goto('/'); await page.getByRole('button', { name: /Stress Lab/ }).click();
  await page.getByRole('button', { name: 'Start stress test', exact: true }).click();
  await expect(page.getByText('Found it. A counterexample!')).toBeVisible();
  await expect(page.getByText('Outputs do not match', { exact: true })).toBeVisible();
  await expect(page.locator('.counterexample-cell pre').first()).toHaveText('2\n7 8\n');
  await page.waitForTimeout(600); // Allow the debounced browser draft to persist.
  await page.reload(); await page.getByRole('button', { name: /Stress Lab/ }).click();
  await expect(page.getByText('Found it. A counterexample!')).toBeVisible();
});
