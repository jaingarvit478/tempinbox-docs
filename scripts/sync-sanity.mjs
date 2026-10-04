import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { articleToMdx, hash } from './article-to-mdx.mjs';
import { fetchSources, validateSources } from './sanity-client.mjs';

export function validateManifest(entries) {
  if(!Array.isArray(entries)||!entries.length) throw new Error('Empty or invalid manifest.');
  const ids=new Set(),paths=new Set();
  for(const entry of entries) {
    if(!/^[\w.-]+$/.test(entry.id)||entry.id.startsWith('drafts.')||!/^guides\/[a-z0-9-]+$/.test(entry.path)||entry.group!=='Browser Guides') throw new Error('Unsafe manifest entry.');
    if(ids.has(entry.id)||paths.has(entry.path)) throw new Error('Duplicate manifest identity.');
    ids.add(entry.id); paths.add(entry.path);
  }
  return entries;
}
export async function planExport(entries,records,files,{migration=false}={}) {
  validateManifest(entries); validateSources(entries,records);
  const changes=[];
  for(const entry of entries) {
    const path=entry.path+'.mdx', old=files.get(path);
    if(old) {
      const marker=old.match(/\{\/\* Generated from Sanity\.[\s\S]*?source-id: ([^\n]+)\nsource-revision: ([^\n]+)\ncontent-sha256: ([a-f0-9]{64})\n\*\/\}\n/);
      if(!marker&&!migration) throw new Error(`${path} requires an explicit first migration.`);
      if(marker) {
        if(marker[1]!==entry.id) throw new Error(`${path} has conflicting source ownership.`);
        if(hash(old.replace(marker[0],''))!==marker[3]) throw new Error(`${path} was manually edited; move edits to Sanity first.`);
      }
    }
    const content=await articleToMdx(records.find(doc=>doc._id===entry.id));
    if(content!==old) changes.push({path,content});
  }
  return changes;
}
export async function sync({root=process.cwd(),apply=false,migration=false,token,fetchSource=fetchSources,validateCandidate}={}) {
  const entries=validateManifest(JSON.parse(await readFile(join(root,'content/sanity-map.json'),'utf8')));
  const records=await fetchSource(entries,{token});
  const files=new Map();
  for(const entry of entries) {
    try{files.set(entry.path+'.mdx',await readFile(join(root,entry.path+'.mdx'),'utf8'));}catch(error){if(error.code!=='ENOENT') throw error;}
  }
  const changes=await planExport(entries,records,files,{migration});
  const originalNav=await readFile(join(root,'docs.json'),'utf8');
  const docs=JSON.parse(originalNav);
  const groups=docs.navigation.tabs.find(tab=>tab.tab==='Docs')?.groups;
  const group=groups?.find(group=>group.group==='Browser Guides');
  if(!group) throw new Error('Managed navigation group missing.');
  // Retain manual pages and add mapped destinations in manifest order.
  group.pages=[...new Set([...group.pages,...entries.map(entry=>entry.path)])];
  const nav=JSON.stringify(docs,null,2)+'\n';
  if(nav!==originalNav) changes.push({path:'docs.json',content:nav});
  console.log(JSON.stringify({sources:records.map(doc=>({id:doc._id,revision:doc._rev})),changed:changes.map(change=>change.path)},null,2));
  if(!changes.length) return {changed:[]};
  const candidate=await mkdtemp(join(tmpdir(),'tempinbox-sanity-candidate-'));
  await cp(root,candidate,{recursive:true,filter:source=>!['.git','node_modules'].includes(source.split('/').at(-1))});
  // Validator binary comes from the locked dependencies of the checkout.
  for(const change of changes) {await mkdir(resolve(candidate,change.path,'..'),{recursive:true});await writeFile(join(candidate,change.path),change.content);}
  if(validateCandidate) await validateCandidate(candidate);
  else for(const args of [['validate'],['broken-links']]) {
    const result=spawnSync(join(root,'node_modules/.bin/mintlify'),args,{cwd:candidate,encoding:'utf8',timeout:180000});
    process.stdout.write(result.stdout||''); process.stderr.write(result.stderr||'');
    if(result.error||result.status!==0) throw new Error(`Candidate ${args[0]} failed; no files installed. Preview: ${candidate}`);
  }
  console.log(`Validated preview: ${candidate}`);
  if(apply) {
    // Check every original again before installing any validated output.
    for(const entry of entries) {
      let current;try{current=await readFile(join(root,entry.path+'.mdx'),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
      if(current!==files.get(entry.path+'.mdx')) throw new Error('Docs changed during generation; rerun.');
    }
    if(await readFile(join(root,'docs.json'),'utf8')!==originalNav) throw new Error('Navigation changed during generation; rerun.');
    const backups=changes.map(change=>({path:change.path,content:change.path==='docs.json'?originalNav:files.get(change.path)}));
    try {for(const change of changes){await mkdir(resolve(root,change.path,'..'),{recursive:true});await writeFile(join(root,change.path),change.content);}}
    catch(error){for(const backup of backups){if(backup.content===undefined)await rm(join(root,backup.path),{force:true});else await writeFile(join(root,backup.path),backup.content);}throw error;}
  }
  return {changed:changes.map(change=>change.path),candidate};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--apply','--migration'].includes(arg))) throw new Error('Options: --apply, --migration.');
  await sync({apply:args.includes('--apply'),migration:args.includes('--migration')});
}
