import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { compile } from '@mdx-js/mdx';
import { createHash } from 'node:crypto';

const SITE = 'https://tempinbox.dev';
export const hash = text => createHash('sha256').update(text).digest('hex');
const escape = text => String(text || '').replace(/&/g,'&amp;').replace(/\{/g,'&#123;').replace(/\}/g,'&#125;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/(^|\n)(\s*)(import|export)\b/g,(_match,start,space,word)=>`${start}${space}&#${word.charCodeAt(0)};${word.slice(1)}`);
function safeMdx() {
  return tree=>{
    const visit=node=>{
      if(node.type==='mdxjsEsm'||node.type==='mdxJsxFlowElement'||node.type==='mdxJsxTextElement'||node.type==='mdxTextExpression') throw new Error('Executable MDX is not allowed in article mirrors.');
      if(node.type==='mdxFlowExpression'&&!/^\/\* Generated from Sanity\.[\s\S]*\*\/$/.test(node.value)) throw new Error('Unexpected MDX expression.');
      for(const child of node.children||[]) visit(child);
    };visit(tree);
  };
}
const prose = text => escape(text).replace(/([\\`*_\[\]])/g,'\\$1');
function safeUrl(value) {
  try {
    const url = new URL(value, SITE);
    if(!['https:','http:'].includes(url.protocol)) return null;
    return url.href.replace(/[()]/g, c=>c==='('? '%28':'%29');
  } catch { return null; }
}
export async function articleToMdx(article) {
  const slug = article.slug?.current;
  if(!slug || !article.title || !article.description || !article.body) throw new Error(`Incomplete source: ${article._id}`);
  const canonical = safeUrl(article.canonicalUrl || `${SITE}/blog/${encodeURIComponent(slug)}`);
  if(!canonical) throw new Error(`Invalid canonical: ${article._id}`);
  const converter = new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});
  converter.use(gfm);
  converter.remove(['script','style','iframe','object','embed','form','input','button','svg','math']);
  converter.addRule('noBodyH1',{filter:'h1',replacement:()=>''});
  converter.addRule('noLegacyByline',{filter:node=>
    (node.nodeName==='TIME' && node.classList.contains('meta')) ||
    (node.nodeName==='P' && node.classList.contains('author-byline')),
    replacement:()=>''});
  converter.addRule('links',{filter:'a',replacement:(content,node)=>{
    const url = safeUrl(node.getAttribute('href'));
    return url && content.trim() ? `[${content}](${url})` : content;
  }});
  converter.addRule('noImages',{filter:'img',replacement:(_content,node)=>prose(node.getAttribute('alt')||'')});
  // Escape text nodes before serializing, but preserve inline and fenced code.
  const originalEscape = converter.escape.bind(converter);
  converter.escape = text => originalEscape(escape(text));
  converter.addRule('codeBlock',{filter:node=>node.nodeName==='PRE',replacement:(_content,node)=>{
    const code = node.textContent.replace(/\n$/,'');
    const runs = code.match(/`+/g) || [];
    const fence = '`'.repeat(Math.max(3,...runs.map(run=>run.length+1)));
    const lang = (node.firstElementChild?.getAttribute('class')||'').match(/(?:^|\s)language-([\w-]+)/)?.[1] || '';
    return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
  }});
  let body = converter.turndown(article.body).trim();
  const date=value=>/^\d{4}-\d{2}-\d{2}/.exec(value||'')?.[0];
  const published=date(article.publishedAt),updated=date(article._updatedAt);
  const dates=[published?`Published ${published}`:'',updated&&updated!==published?`Updated ${updated}`:''].filter(Boolean).join(' · ');
  if(dates) body=`${dates}\n\n${body}`;
  if(article.answerSummary) body = `${prose(article.answerSummary)}\n\n${body}`;
  if(article.faq?.length) body += '\n\n## Frequently asked questions\n\n' + article.faq.map(item=>`### ${prose(item.question)}\n\n${prose(item.answer)}`).join('\n\n');
  if(article.internalLinks?.length) body += '\n\n## Related guides\n\n' + article.internalLinks.map(link=>{
    const url=safeUrl(link.href); if(!url) throw new Error(`Unsafe related link: ${article._id}`);
    return `- [${prose(link.label)}](${url})`;
  }).join('\n');
  body += `\n\n[Read the source article on TempInbox](${canonical}).\n`;
  const payload = `---\ntitle: ${JSON.stringify(article.title)}\ndescription: ${JSON.stringify(article.description)}\ncanonical: ${JSON.stringify(canonical)}\n---\n\n${body}`;
  await compile(payload.replace(/^---\n[\s\S]*?\n---\n/,''),{development:false,remarkPlugins:[safeMdx]});
  const marker = `{/* Generated from Sanity. Edit the source article, not this file.\nsource-id: ${article._id}\nsource-revision: ${article._rev}\ncontent-sha256: ${hash(payload)}\n*/}\n`;
  const output = payload.replace(/^(---\n[\s\S]*?\n---\n\n)/, `$1${marker}`);
  await compile(output.replace(/^---\n[\s\S]*?\n---\n/,''),{development:false,remarkPlugins:[safeMdx]});
  return output;
}
