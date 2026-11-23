import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openBoard(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Whiteboard/ }).click();
  await expect(page.getByRole('application', { name: 'Whiteboard canvas' })).toBeVisible();
}
async function drag(page: Page, start: [number, number], end: [number, number]) {
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + start[0], box.y + start[1]); await page.mouse.down();
  await page.mouse.move(box.x + end[0], box.y + end[1], { steps: 15 }); await page.mouse.up();
}
async function signedIn(page: Page) {
  await page.addInitScript(() => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), btoa(JSON.stringify({ sub: '11111111-1111-4111-8111-111111111111', exp, role: 'authenticated' })), 'test-signature'].join('.');
    localStorage.setItem('sb-hlgkzndgvyumoxnsaozl-auth-token', JSON.stringify({ access_token: token, refresh_token: 'test-token', token_type: 'bearer', expires_at: exp, expires_in: 3600, user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'player@example.com', created_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: { username: 'whiteboard_tester' } } }));
  });
}

test('light mode covers the editors, dialogs, navigation, and survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.cm-editor').first()).toHaveCSS('background-color', 'rgb(251, 252, 254)');
  await expect(page.getByRole('textbox', { name: 'Custom input' })).toBeVisible();
  await page.screenshot({ path: 'test-results/ide-light.png', fullPage: true });
  await page.getByRole('button', { name: /Sign in.*Sign up/ }).click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(240, 243, 247)');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.getByRole('button', { name: /Stress Lab/ }).click();
  await expect(page.getByRole('heading', { name: 'Brute-force solution', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Whiteboard/ }).click();
  await page.getByRole('combobox', { name: 'Insert diagram' }).selectOption('tree');
  await page.screenshot({ path: 'test-results/whiteboard-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.mouse.move(2, 2);
  await expect(page.locator('.theme-toggle')).toHaveCSS('background-color', 'rgb(25, 28, 36)');
  await page.screenshot({ path: 'test-results/whiteboard-dark.png', fullPage: true });
});

test('draw, label, select, move, erase, and undo diagrams with a persistent local draft', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openBoard(page);
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, [100, 80], [240, 160]);
  await expect(page.locator('[data-element-type="rectangle"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Arrow', exact: true }).click();
  await drag(page, [320, 100], [470, 140]);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const canvas = page.getByRole('application', { name: 'Whiteboard canvas' });
  await canvas.click({ position: { x: 100, y: 240 } });
  await page.getByRole('textbox', { name: 'Board text' }).fill('dist[u] = dist[v] + w');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await expect(page.locator('[data-element-type="text"]')).toContainText('dist[u]');
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await drag(page, [340, 260], [470, 310]);
  await expect(page.locator('[data-element-id]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await drag(page, [160, 120], [240, 180]);
  await expect(page.locator('[data-element-type="rectangle"] rect')).toHaveAttribute('x', '180');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-element-type="rectangle"] rect')).toHaveAttribute('x', '100');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-element-type="rectangle"] rect')).toHaveAttribute('x', '180');
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await drag(page, [180, 160], [190, 160]);
  await expect(page.locator('[data-element-type="rectangle"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('awb-whiteboard-guest') || '{}').document?.elements.length)).toBe(4);
  await page.reload(); await page.getByRole('button', { name: /^Whiteboard/ }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(4);
});

test('presets, zoom, clear/undo, SVG/PNG/JSON export, and JSON import work', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openBoard(page);
  await page.getByRole('combobox', { name: 'Insert diagram' }).selectOption('graph');
  await expect(page.locator('[data-element-type="ellipse"]')).toHaveCount(5);
  await expect(page.locator('[data-element-type="arrow"]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(page.locator('.wb-zoom')).toContainText('120%');
  await page.getByRole('button', { name: 'Fit board', exact: true }).click();
  await page.getByRole('button', { name: 'Clear board', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear board', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(16);
  for (const format of ['svg', 'png', 'json']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('combobox', { name: 'Export board' }).selectOption(format);
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`Untitled_board.${format}`);
    const data = await readFile((await download.path())!);
    if (format === 'svg') expect(data.toString()).toContain('<svg');
    if (format === 'png') expect(data.subarray(1, 4).toString()).toBe('PNG');
    if (format === 'json') {
      expect(JSON.parse(data.toString()).document.elements).toHaveLength(16);
      await page.getByRole('textbox', { name: 'Board name' }).fill('Changed title');
      await page.getByLabel('Import whiteboard file').setInputFiles({ name: 'graph.json', mimeType: 'application/json', buffer: data });
      await page.getByRole('button', { name: 'Replace board', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Board name' })).toHaveValue('Untitled board');
    }
  }
});

test('signed-in users can save, reopen, and delete private whiteboards', async ({ page }) => {
  await signedIn(page);
  let saved: Record<string, unknown>;
  await page.route('**/api/whiteboards', async route => {
    if (route.request().method() === 'POST') {
      const data = route.request().postDataJSON();
      expect(data.title).toBe('BFS trace'); expect(data.document.elements).toHaveLength(18);
      expect(data.user_id).toBeUndefined();
      saved = { ...data, id: '33333333-3333-4333-8333-333333333333', updated_at: new Date().toISOString() };
      await route.fulfill({ status: 201, json: saved });
    } else await route.fulfill({ json: saved ? [saved] : [] });
  });
  await page.route('**/api/whiteboards/33333333-3333-4333-8333-333333333333', route => route.fulfill({ status: route.request().method() === 'DELETE' ? 204 : 200, ...(route.request().method() === 'DELETE' ? { body: '' } : { json: saved }) }));
  await openBoard(page);
  await page.getByRole('combobox', { name: 'Insert diagram' }).selectOption('array');
  await page.getByRole('textbox', { name: 'Board name' }).fill('BFS trace');
  await page.getByRole('button', { name: 'Save board', exact: true }).click();
  await expect(page.getByText('Saved to account', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'My boards', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(18);
  await page.getByRole('button', { name: 'My boards', exact: true }).click();
  await page.getByRole('button', { name: 'Delete BFS trace', exact: true }).click();
  await page.getByRole('button', { name: 'Delete board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No saved whiteboards', exact: true })).toBeVisible();
});

test('whiteboard tools and the theme toggle remain usable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBoard(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.mouse.move(2, 2);
  await expect(page.locator('.theme-toggle')).toHaveCSS('background-color', 'rgb(240, 243, 247)');
  await page.getByRole('combobox', { name: 'Insert diagram' }).selectOption('array');
  await page.getByRole('button', { name: 'Fit board', exact: true }).click();
  await expect(page.locator('[data-element-id]')).toHaveCount(18);
  await page.screenshot({ path: 'test-results/whiteboard-mobile.png', fullPage: true });
});
