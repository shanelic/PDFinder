// Tiny deterministic ASCII PDF generator for local tests. No real documents,
// remote assets, dynamic code or third-party fixture redistribution.
export function createTextPdf(textPages) {
  if(!Array.isArray(textPages)||!textPages.length||textPages.length>65||textPages.some(t=>typeof t!=='string'||t.length>110000||/[^\x20-\x7e]/.test(t)))throw Error('Synthetic ASCII pages required');
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const text of textPages){
    const page=objects.length+1,content=page+1;kids.push(`${page} 0 R`);
    const stream=text?`BT /F1 12 Tf 24 700 Td (${text.replace(/[\\()]/g,'\\$&')}) Tj ET`:'';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1]=`<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  let pdf='%PDF-1.4\n',offsets=[0];
  objects.forEach((body,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${body}\nendobj\n`;});
  const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
