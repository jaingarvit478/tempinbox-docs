import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { articleToMdx } from './article-to-mdx.mjs';
import { sync } from './sync-sanity.mjs';

const entry = { id: 'article.en.example', path: 'guides/example', group: 'Browser Guides' };
const article = { _id: entry.id, _rev: 'rev1', _updatedAt: '2026-11-18T00:00:00Z', _type: 'article', published: true, locale: 'en', title: 'Example guide', slug: { current: 'example' }, description: 'A source description', body: '<p>Current source body.</p>', publishedAt: '2025-01-02T00:00:00Z' };

async function withCheckout(run) {
  const root = await mkdtemp(join(tmpdir(), 'sanity-freshness-test-'));
  try {
    await mkdir(join(root, 'content'));
    await mkdir(join(root, 'guides'));
    const manifest = JSON.stringify([entry]);
    const nav = JSON.stringify({ navigation: { tabs: [{ tab: 'Docs', groups: [{ group: 'Browser Guides', pages: [entry.path] }] }] } }, null, 2) + '\n';
    const mirror = await articleToMdx(article);
    await writeFile(join(root, 'content/sanity-map.json'), manifest);
    await writeFile(join(root, 'docs.json'), nav);
    await writeFile(join(root, entry.path + '.mdx'), mirror);
    await run({ root, mirror, nav, manifest });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('freshness check rejects changed source body without validation or writes', async () => {
  await withCheckout(async ({ root, mirror, nav, manifest }) => {
    let validations = 0;
    await assert.rejects(sync({ root, check: true, fetchSource: async () => [{ ...article, body: '<p>Corrected source body.</p>' }], validateCandidate: async () => { validations++; } }), /Stale Sanity mirrors: guides\/example\.mdx/);
    assert.equal(validations, 0);
    assert.equal(await readFile(join(root, entry.path + '.mdx'), 'utf8'), mirror);
    assert.equal(await readFile(join(root, 'docs.json'), 'utf8'), nav);
    assert.equal(await readFile(join(root, 'content/sanity-map.json'), 'utf8'), manifest);
  });
});

test('freshness check rejects a revision-only source change', async () => {
  await withCheckout(async ({ root, mirror }) => {
    await assert.rejects(sync({ root, check: true, fetchSource: async () => [{ ...article, _rev: 'rev2', nonExportedMetadata: 'changed' }], validateCandidate: async () => {} }), /Stale Sanity mirrors: guides\/example\.mdx/);
    assert.equal(await readFile(join(root, entry.path + '.mdx'), 'utf8'), mirror);
  });
});

test('freshness check accepts exact current output without candidate validation', async () => {
  await withCheckout(async ({ root }) => {
    let validations = 0;
    const result = await sync({ root, check: true, fetchSource: async () => [article], validateCandidate: async () => { validations++; } });
    assert.deepEqual(result, { changed: [] });
    assert.equal(validations, 0);
  });
});

test('freshness check refuses missing managed files and incomplete source data', async () => {
  await withCheckout(async ({ root }) => {
    await assert.rejects(sync({ root, check: true, fetchSource: async () => [] }), /Missing or duplicate source/);
    await rm(join(root, entry.path + '.mdx'));
    await assert.rejects(sync({ root, check: true, fetchSource: async () => [article], validateCandidate: async () => {} }), /Stale Sanity mirrors: guides\/example\.mdx/);
    await assert.rejects(readFile(join(root, entry.path + '.mdx')), /ENOENT/);
  });
});

test('freshness check cannot be combined with apply or migration', async () => {
  await withCheckout(async ({ root }) => {
    for (const option of [{ apply: true }, { migration: true }]) {
      await assert.rejects(sync({ root, check: true, ...option, fetchSource: async () => [article] }), /--check cannot be combined with --apply or --migration/);
    }
  });
});
