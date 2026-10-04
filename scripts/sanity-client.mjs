export function validateSources(entries, records) {
  if(!Array.isArray(records)) throw new Error('Sanity returned an invalid result.');
  return entries.map(entry=>{
    const matches=records.filter(doc=>doc._id===entry.id);
    if(matches.length!==1) throw new Error(`Missing or duplicate source ${entry.id}; review removal before publishing.`);
    const doc=matches[0];
    if(doc._id.startsWith('drafts.') || doc._type!=='article' || doc.published!==true || doc.locale!=='en') throw new Error(`Source ${entry.id} is withdrawn or ineligible; review visibility before publishing.`);
    if(!doc._rev || !doc._updatedAt) throw new Error(`Missing source revision ${entry.id}.`);
    return doc;
  });
}
export async function fetchSources(entries,{token=process.env.SANITY_READ_TOKEN,fetchImpl=fetch}={}) {
  if(!token) throw new Error('SANITY_READ_TOKEN is required (read-only).');
  const url=new URL('https://mwsr32ed.api.sanity.io/v2024-10-01/data/query/production');
  // Exact IDs intentionally query presence independently of publication eligibility.
  url.searchParams.set('query','*[_id in $ids]{_id,_rev,_updatedAt,_type,published,locale,title,slug,description,answerSummary,body,faq,internalLinks,publishedAt,canonicalUrl,previousSlugs}');
  url.searchParams.set('$ids',JSON.stringify(entries.map(entry=>entry.id)));
  const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`Sanity read failed: HTTP ${response.status}.`);
  const json=await response.json();
  return validateSources(entries,json.result);
}
