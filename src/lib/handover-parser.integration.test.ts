import {describe,expect,it,vi} from 'vitest';
import {parseHandoverFile} from './handover-import';

// Use Mammoth's actual browser distribution, which accepts ArrayBuffer. Its
// Node entry point accepts Buffer instead; no text-extraction logic is mocked.
vi.mock('mammoth',async()=>{
  const {createRequire}=await import('node:module');
  return createRequire(import.meta.url)('mammoth/mammoth.browser.js');
});
// Vite emits this URL for browsers. In a Node integration test the real PDF.js
// worker needs a local file URL; extraction still runs in the actual worker.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url',async()=>{
  const {createRequire}=await import('node:module'),{pathToFileURL}=await import('node:url');
  return{default:pathToFileURL(createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href};
});

const tinyDocx='UEsDBBQAAAAIAMGeXV10JJxTuwAAAD4BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbJWQuQ7CMAyGX6XKiqgRAwNquwArMPACVuq2EbkUuxxvT8o1sDHa//FZrk73SFzcnPVcq0EkrgFYD+SQyxDJZ6ULyaHkMfUQUZ+xJ1guFivQwQt5mcvUoZpqSx2OVordLa/ZBF+rRJZVsXkZJ1atMEZrNErW4eLbH8r8TShz8unhwUSeZYOCpjpcKCXTUnHEJHt0uQ6uIbXQBj26jCgn41+80HVG0zc/tcUUNDEb3ztbfhWHxn/ugOfbmgdQSwMEFAAAAAgAwZ5dXWF7L0OJAAAA8gAAAAsAAABfcmVscy8ucmVsc43POw4CIRAG4KsQDrCzWlgYoLLZ1ngBAsMjLo8MGPX2UlisxsJy5p98f0accdU9ltxCrI090pqb5KH3egRoJmDSbSoV80hcoaT7GMlD1eaqPcJ+ng9AW4MrsTXZYiWnxe44uzwr/mMX56LBUzG3hLn/qPi6GLImj13yeyEL9r2eBstBCfh4Ub0AUEsDBBQAAAAIAMGeXV2y+tsIlwAAAOcAAAARAAAAd29yZC9kb2N1bWVudC54bWxtj1EKwjAMhq9SdoB1+OBDmbuCD56gS7O1sCaljdbd3lUQQXz5fkLy8ZOxGsdwj0iinnGjYuql8yLJaF3AY7Sl54R07BbO0cox5lVXzi5lBiwl0Bo3fRqGs442UDeN1czs9papITfIdNtJPEoA5S05fmBWFgCTWALsR91uGvOb6Ve/VjoMYTWjAqYl5Ijun6Y/9fr72vQCUEsBAhQDFAAAAAgAwZ5dXXQknFO7AAAAPgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACADBnl1dYXsvQ4kAAADyAAAACwAAAAAAAAAAAAAAgAHsAAAAX3JlbHMvLnJlbHNQSwECFAMUAAAACADBnl1dsvrbCJcAAADnAAAAEQAAAAAAAAAAAAAAgAGeAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAZAIAAAAA';

function tinyPdf(pages:string[]):string {
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${pages.map((_,i)=>`${i+3} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  const fontId=pages.length+3;
  pages.forEach((_,i)=>objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${fontId+i+1} 0 R >>`));
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach(text=>{const stream=text?`BT /F1 12 Tf 20 250 Td (${text}) Tj ET`:'';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);});
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;pdf+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return pdf;
}

describe('real local document parsers',()=>{
  it('extracts both paragraphs from a real minimal DOCX ZIP using the browser build',async()=>{
    const doc=new File([Buffer.from(tinyDocx,'base64')],'actual.docx');
    const parsed=await parseHandoverFile(doc);
    expect(parsed.text).toBe('【PARA 1】\nSynthetic handover acceptance.\n\n【PARA 2】\nOwner to be confirmed.');
  });
  it('extracts text from a real two-page PDF via the PDF.js worker',async()=>{
    const parsed=await parseHandoverFile(new File([tinyPdf(['Synthetic handover acceptance.','Owner to be confirmed.'])],'actual.pdf'));
    expect(parsed.text).toContain('【PAGE 1】\n【PARA 1】\nSynthetic handover acceptance.');expect(parsed.text).toContain('【PAGE 2】\n【PARA 1】\nOwner to be confirmed.');
  });
  it('rejects an actual PDF page with no text rather than returning a partial result',async()=>{
    await expect(parseHandoverFile(new File([tinyPdf(['Readable page',''])],'partial.pdf'))).rejects.toThrow('第 2 页');
  });
});
