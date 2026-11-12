// Pure search over already-validated pages. Source identity is a trusted-host
// assertion, not cryptographically proved by a content hash. No link is invented.
const MAX_MATCHES=20;
const chars=value=>Array.from(value);
export function findLiteralMatches(pages,query,source,sha256) {
  if(typeof query!=='string' || !query.length) throw new TypeError('Nonempty literal query required');
  const needle=chars(query),matches=[];let truncated=false;
  for(const page of pages) {
    const text=chars(page.text);
    for(let i=0;i<=text.length-needle.length;i++) {
      if(!needle.every((c,j)=>text[i+j]===c)) continue;
      if(matches.length===MAX_MATCHES) {truncated=true;return {matches,truncated};}
      const start=Math.max(0,i-24),end=Math.min(text.length,i+needle.length+24);
      matches.push({source:{...source},sha256,page:page.page,
        range:{start:i,end:i+needle.length,unit:'unicode_codepoint',end_exclusive:true},
        quote:query,context:{start,end,text:text.slice(start,end).join('')}});
    }
  }
  return {matches,truncated};
}

