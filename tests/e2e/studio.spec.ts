import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { unzipSync } from 'fflate';
import { newPost, type Asset, type Project } from '../../src/lib/domain';

const origin = 'http://127.0.0.1:3100';

test('create a collection, import safely, edit, persist, and export ordered JPEGs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const title = `Browser workflow ${Date.now()}`;
  const files = await Promise.all([
    { name: 'landscape.jpg', width: 900, height: 600, color: '#d76745' },
    { name: 'portrait.jpg', width: 600, height: 900, color: '#54756e' },
    { name: 'detail.jpg', width: 600, height: 600, color: '#cdb65e' },
  ].map(async f => ({ name: f.name, mimeType: 'image/jpeg', buffer: await sharp({ create: { width: f.width, height: f.height, channels: 3, background: f.color } }).jpeg().toBuffer() })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a collection' }).click();
  await page.getByLabel('COLLECTION NAME').fill(title);
  await page.getByRole('button', { name: 'Create collection', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByLabel('Photo files', { exact: true }).setInputFiles(files);
  await expect(page.getByText('3 of 3 imported')).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Photo files', { exact: true }).setInputFiles(files[0]);
  await expect(page.getByText('Existing copies were skipped.')).toBeVisible();
  await page.getByRole('button', { name: 'Select landscape.jpg', exact: true }).click();
  await page.getByRole('button', { name: 'Select portrait.jpg', exact: true }).click();
  await page.getByRole('button', { name: 'Make a post', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Carousel editor' });
  await expect(editor).toBeVisible();
  await page.getByLabel('Post title').fill('Synthetic story');
  await page.getByRole('button', { name: 'Black', exact: true }).click();
  await page.getByRole('button', { name: 'Apply framing to all slides' }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('button', { name: 'Full bleed', exact: true }).click();
  await page.getByLabel('Zoom', { exact: true }).fill('1.5');
  await page.getByRole('button', { name: 'Pin position', exact: true }).click();
  await page.getByRole('button', { name: 'Earlier', exact: true }).click();
  await page.getByLabel('Add photo to post').selectOption({ label: 'detail.jpg' });
  await expect(editor.getByText('Saved locally', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export ZIP', exact: true }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const images = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(images)).toEqual(['01.jpg', '02.jpg', '03.jpg', '04.jpg']);
  for (const bytes of Object.values(images)) {
    const m = await sharp(bytes).metadata();
    expect([m.width, m.height, m.format]).toEqual([1080, 1350, 'jpeg']);
    expect(m.exif).toBeUndefined();
  }
  const projectId = page.url().split('/').pop();
  const persisted = await (await page.request.get(`/api/projects/${projectId}`)).json() as Project;
  expect(persisted.assets).toHaveLength(3);
  expect(persisted.document.posts[0].slides[0].pinned).toBe(true);
  expect(persisted.document.posts[0].slides[0].frame.zoom).toBe(1.5);
  await page.getByRole('button', { name: 'Back to the board' }).click();
  await page.getByRole('button', { name: 'Contact sheets', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit Synthetic story' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Synthetic story' })).toBeVisible();
  await page.getByRole('button', { name: 'Curate with AI', exact: true }).click();
  await expect(page.getByText('AI isn’t connected yet.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Curate my photographs' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('AI proposals require consent and explicit acceptance, with recoverable failure', async ({ page, request }) => {
  const response = await request.post('/api/projects', { headers: { Origin: origin }, data: { title: `AI review ${Date.now()}` } });
  const project = await response.json() as Project;
  const image = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#738a58' } }).jpeg().toBuffer();
  const upload = await request.post(`/api/projects/${project.id}/assets`, { headers: { Origin: origin, 'Content-Type': 'application/octet-stream', 'X-File-Name': 'synthetic.jpg' }, data: image });
  const { asset } = await upload.json() as { asset: Asset };
  const proposal = { ...newPost([asset.id], 0, 'A quieter rhythm'), status: 'draft' as const, lens: 'Editorial story', rationale: 'A synthetic proposal for testing the review flow.' };
  let runId = '';
  let fail = false;
  await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, used: 0, limit: 1, model: 'mock-provider-no-network' } }));
  await page.route('**/analyze', route => {
    const input = route.request().postDataJSON();
    expect(input.consent).toBe(true);
    runId = input.runId;
    return fail ? route.fulfill({ status: 502, json: { error: 'Synthetic AI failure. Your edits are unchanged.' } }) : route.fulfill({ json: { analyzed: 1, cached: 0, cost: 0 } });
  });
  await page.route('**/curate', route => {
    const input = route.request().postDataJSON();
    expect(input.runId).toBe(runId);
    expect(input.consent).toBe(true);
    return route.fulfill({ json: { posts: [proposal], cost: 0 } });
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Curate with AI', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Find the stories within.' });
  await expect(dialog.getByRole('button', { name: 'Curate my photographs' })).toBeDisabled();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Curate my photographs' }).click();
  await expect(dialog.getByText('Ready for your eye.', { exact: false })).toBeVisible();
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).document.posts).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Add proposals to board' }).click();
  await expect(page.getByRole('button', { name: 'Edit A quieter rhythm' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep this story' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
  expect(saved.document.posts[0].status).toBe('accepted');
  fail = true;
  await page.getByRole('button', { name: 'Curate with AI', exact: true }).click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Curate my photographs' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Synthetic AI failure. Your edits are unchanged.');
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).document.posts).toEqual(saved.document.posts);
});

test('resume skips cached photos, preserves the run allowance, and explains held estimates', async ({ page, request }) => {
  const created = await request.post('/api/projects', { headers: { Origin: origin }, data: { title: `Resume ${Date.now()}` } });
  const project = await created.json() as Project;
  const ids: string[] = [];
  for (let i = 0; i < 7; i++) {
    const image = await sharp({ create: { width: 30 + i, height: 20, channels: 3, background: '#738a58' } }).jpeg().toBuffer();
    const upload = await request.post(`/api/projects/${project.id}/assets`, { headers: { Origin: origin, 'X-File-Name': `test-${i}.jpg` }, data: image });
    ids.push((await upload.json()).asset.id);
  }
  const cached = new Set<string>();
  const calls: { assetIds: string[]; runId: string }[] = [];
  let failOnce = true;
  await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, used: 0.1, recorded: 0.06, reserved: 0.04, pending: 0, uncertain: 0.04, limit: 1, model: 'mock-provider' } }));
  await page.route(`**/projects/${project.id}/analysis`, route => route.fulfill({ json: { ids: [...cached] } }));
  await page.route('**/analyze', route => {
    const input = route.request().postDataJSON();
    calls.push(input);
    if (input.assetIds.length === 1 && failOnce) {
      failOnce = false;
      return route.fulfill({ status: 502, json: { error: 'Provider unavailable after 2 attempts.' } });
    }
    input.assetIds.forEach((id: string) => cached.add(id));
    return route.fulfill({ json: { analyzed: input.assetIds.length, cached: 0, cost: 0 } });
  });
  await page.route('**/curate', route => {
    expect(route.request().postDataJSON().runId).toBe(calls[0].runId);
    return route.fulfill({ json: { posts: [{ ...newPost(ids.slice(0, 3), 0, 'Resumed story'), status: 'draft' }], cost: 0 } });
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Curate with AI', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Find the stories within.' });
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Curate my photographs' }).click();
  await expect(dialog.getByText('6 / 7 photos analyzed and saved.')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('Provider unavailable after 2 attempts.');
  await expect(dialog.locator('.budget-note')).toContainText('Recorded token cost: $0.060');
  await expect(dialog.locator('.budget-note')).toContainText('Held reservations: $0.040');
  await dialog.getByRole('button', { name: 'Resume 1 unfinished photo' }).click();
  await expect(dialog.getByText('Ready for your eye.', { exact: false })).toBeVisible();
  expect(calls.map(c => c.assetIds)).toEqual([ids.slice(0, 6), ids.slice(6), ids.slice(6)]);
  expect(new Set(calls.map(c => c.runId)).size).toBe(1);
  await expect(dialog.getByText('7 / 7 photos analyzed and saved.')).toBeVisible();
});

test('post-generation failure retries only Sonnet composition and keeps cached photo analyses', async ({ page, request }) => {
  const created = await request.post('/api/projects', { headers: { Origin: origin }, data: { title: 'Cached composition retry' } });
  const project = await created.json() as Project;
  project.assets = Array.from({ length: 3 }, (_, i) => ({ id: crypto.randomUUID(), projectId: project.id, filename: `synthetic-${i}.jpg`, hash: `fake-${i}`, width: 600, height: 400, bytes: 100, capturedAt: null, createdAt: new Date().toISOString() }));
  const ids = project.assets.map(asset => asset.id);
  const runs: string[] = [];
  let analyses = 0;
  await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ json: project }));
  await page.route('**/api/assets/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"/>' }));
  await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, used: 0, limit: 1, model: 'claude-haiku-4-5-20251001', curationModel: 'claude-sonnet-4-6' } }));
  await page.route('**/analysis', route => route.fulfill({ json: { ids } }));
  await page.route('**/analyze', route => { analyses++; return route.fulfill({ status: 500, json: { error: 'Cached photos should never be analyzed again.' } }); });
  await page.route('**/curate', route => {
    const input = route.request().postDataJSON();
    runs.push(input.runId);
    expect(input.assetIds).toEqual(ids);
    if (runs.length === 1) return route.fulfill({ status: 400, json: { error: 'AI assigned photos to the same slide position. No proposal was applied; cached analyses are kept. Retry post generation.' } });
    return route.fulfill({ json: { posts: [{ ...newPost(ids, 0, 'Recovered composition'), status: 'draft' }], consideredCount: 3, selectedCount: 3 } });
  });
  await page.goto(`/projects/${project.id}`);
  await page.getByRole('button', { name: 'Curate with AI', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Find the stories within.' });
  await expect(dialog.locator('.ai-budget')).toContainText('SONNET 4.6 STORIES');
  await expect(dialog.getByText('3 / 3 photos analyzed and saved.')).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Curate my photographs' }).click();
  await expect(dialog.getByRole('alert')).toContainText('cached analyses are kept');
  expect(runs).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Retry post generation' }).click();
  await expect(dialog.getByText('Ready for your eye.', { exact: false })).toBeVisible();
  expect(runs).toHaveLength(2);
  expect(new Set(runs).size).toBe(1);
  expect(analyses).toBe(0);
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).document.posts).toHaveLength(0);
});

test('board nodes initialize, drag without warnings, and save only the final position', async ({ page, request }) => {
  const response = await request.post('/api/projects', { headers: { Origin: origin }, data: { title: `Dragging ${Date.now()}` } });
  const project = await response.json() as Project;
  const post = newPost([], 0, 'Drag this story');
  await request.put(`/api/projects/${project.id}`, { headers: { Origin: origin }, data: { revision: 0, document: { ...project.document, posts: [post] } } });
  const warnings: string[] = [];
  page.on('console', message => { if (message.text().includes('[React Flow]')) warnings.push(message.text()); });
  await page.goto(`/projects/${project.id}`);
  const handle = page.locator('.post-drag-handle');
  await expect(handle).toBeVisible();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Missing node drag handle.');
  const writes: string[] = [];
  page.on('request', req => { if (req.method() === 'PUT') writes.push(req.url()); });
  await page.mouse.move(bounds.x + 50, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 180, bounds.y + 70, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => {
    const saved = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
    return saved.document.posts[0].position.x;
  }).toBeGreaterThan(80);
  expect(warnings).toEqual([]);
  expect(writes.length).toBeLessThanOrEqual(2);
  await page.reload();
  await expect(handle).toBeVisible();
  expect(warnings).toEqual([]);
});

for (const size of [170, 300]) {
  test(`curates all ${size} photos in batches with configurable post count and allowance`, async ({ page, request }) => {
    const created = await request.post('/api/projects', { headers: { Origin: origin }, data: { title: `Large browser collection ${size}` } });
    const project = await created.json() as Project;
    project.assets = Array.from({ length: size }, (_, i) => ({ id: crypto.randomUUID(), projectId: project.id, filename: `synthetic-${i}.jpg`, hash: `fake-${i}`, width: 600, height: 400, bytes: 100, capturedAt: null, createdAt: new Date().toISOString() }));
    const ids = project.assets.map(a => a.id);
    const cached = new Set(ids.slice(0, 50));
    const analyzed: string[] = [];
    const runs = new Set<string>();
    const desired = size === 170 ? 12 : 2;
    await page.route(`**/api/projects/${project.id}`, route => route.fulfill({ json: project }));
    await page.route('**/api/assets/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40"><rect width="60" height="40" fill="#738a58"/></svg>' }));
    await page.route('**/api/settings', route => route.fulfill({ json: { configured: true, used: 0, limit: 3, model: 'mock-provider' } }));
    await page.route(`**/projects/${project.id}/analysis`, route => route.fulfill({ json: { ids: [...cached] } }));
    await page.route('**/analyze', route => {
      const input = route.request().postDataJSON();
      expect(input.assetIds.length).toBeLessThanOrEqual(6);
      expect(input.budgetUsd).toBe(2);
      runs.add(input.runId);
      for (const id of input.assetIds) { expect(cached.has(id)).toBe(false); cached.add(id); analyzed.push(id); }
      return route.fulfill({ json: { analyzed: input.assetIds.length, cached: 0, cost: 0 } });
    });
    await page.route('**/curate', route => {
      const input = route.request().postDataJSON();
      expect(input.assetIds).toEqual(ids);
      expect(input.count).toBe(size === 170 ? 12 : null);
      expect(input.minSlides).toBe(3);
      expect(input.maxSlides).toBe(5);
      expect(input.budgetUsd).toBe(2);
      runs.add(input.runId);
      const posts = Array.from({ length: desired }, (_, i) => ({ ...newPost(ids.slice(size - desired * 3 + i * 3, size - desired * 3 + (i + 1) * 3), i, `Highlight ${i + 1}`), status: 'draft' }));
      return route.fulfill({ json: { posts, cost: 0, consideredCount: size, selectedCount: desired * 3 } });
    });
    await page.goto(`/projects/${project.id}`);
    await page.getByRole('button', { name: 'Curate with AI', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Find the stories within.' });
    await expect(dialog.getByText(`${size} photographs considered`)).toBeVisible();
    await expect(dialog.getByLabel('Number of stories')).toHaveValue('auto');
    if (size === 170) await dialog.getByLabel('Number of stories').selectOption('12');
    await dialog.getByLabel('Maximum photos per post').fill('5');
    await dialog.getByLabel('Run allowance in USD').fill('2');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Curate my photographs' }).click();
    await expect(dialog.getByText('Ready for your eye.', { exact: false })).toBeVisible();
    expect(analyzed).toEqual(ids.slice(50));
    expect(runs.size).toBe(1);
    await expect(dialog.getByText(`${size} considered · ${desired * 3} chosen · ${size - desired * 3} left in the library.`)).toBeVisible();
  });
}

test('mutations reject cross-origin and missing-origin requests', async ({ request }) => {
  const cross = await request.post('/api/projects', { headers: { Origin: 'https://example.com' }, data: { title: 'Blocked' } });
  expect(cross.status()).toBe(403);
  const missing = await request.post('/api/projects', { data: { title: 'Blocked' } });
  expect(missing.status()).toBe(403);
  const local = await request.post('/api/projects', { headers: { Origin: origin }, data: {} });
  expect(local.status()).toBe(400);
});
