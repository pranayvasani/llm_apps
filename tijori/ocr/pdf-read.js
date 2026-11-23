/* Tijori: read PDFs for Scan to fill, on the device.
   Digital PDFs: use their text layer directly (exact, no OCR).  Scanned PDFs: render pages to images for the OCR reader.
   window.TijoriPDF = { open(bytes, base, askPassword) -> doc, pages(doc, opts) -> async iterator }  */
(function () {
  'use strict';
  let lib = null;
  async function load(base) {
    if (lib) return lib;
    lib = await import(base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
    return lib;
  }

  // askPassword(wrongBefore) -> string | { pw, remember } | null (null = cancelled).  knownPassword is tried first, silently.
  async function open(bytes, base, askPassword, knownPassword) {
    const pdfjs = await load(base);
    let password = knownPassword || undefined, remember = true;
    for (;;) {
      const task = pdfjs.getDocument({
        data: bytes.slice(),                 // the worker takes ownership of the buffer, so pass a copy each try
        password,
        isEvalSupported: false,              // no eval/new Function
        enableScripting: false,              // never run scripts embedded in a PDF
        wasmUrl: base + 'pdfjs-wasm/',       // image decoders for scanned PDFs (JBIG2, JPEG 2000, colour profiles)
        useSystemFonts: true,
        stopAtErrors: false,
      });
      try { const doc = await task.promise; doc.__task = task; doc.__password = password; doc.__remember = remember; return doc; }
      catch (e) {
        if (e && e.name === 'PasswordException') {
          const r = await askPassword(e.code === 2 && password !== knownPassword);   // code 2 = a password was given and was wrong
          if (r == null) { const c = new Error('Cancelled'); c.cancelled = true; throw c; }
          if (typeof r === 'object') { password = r.pw; remember = r.remember !== false; } else password = r;
          knownPassword = null;
          continue;
        }
        throw new Error('Couldn’t open this PDF' + (e && e.message ? ` (${e.message})` : '') + '.');
      }
    }
  }

  // Turn pdf.js text items into lines of items with x positions, like the photo reader produces.
  function textLines(tc, vp) {
    const raw = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [, , c, d, e, f] = it.transform;
      const [x, y] = vp.convertToViewportPoint(e, f);
      const h = (Math.hypot(c, d) || Math.abs(it.height) || 10) * vp.scale;
      raw.push({ text: it.str, x0: x, w: Math.max(1, it.width * vp.scale), h, y });
    }
    raw.sort((p, q) => p.y - q.y || p.x0 - q.x0);
    const lines = [];
    for (const r of raw) {
      const ln = lines.find(l => Math.abs(l.y - r.y) < Math.min(l.h, r.h) * 0.5);
      if (ln) { ln.parts.push(r); ln.h = Math.max(ln.h, r.h); } else lines.push({ y: r.y, h: r.h, parts: [r] });
    }
    lines.sort((a, b) => a.y - b.y);
    return lines.map(l => {
      l.parts.sort((a, b) => a.x0 - b.x0);
      const items = [];
      for (const p of l.parts) {   // join pieces of one phrase; keep columns (big gaps) apart
        const last = items[items.length - 1]; const gap = last ? p.x0 - (last.x0 + last.w) : Infinity;
        if (last && gap < p.h * 1.2) {
          last.text += (gap > p.h * 0.15 && !/\s$/.test(last.text) && !/^\s/.test(p.text) ? ' ' : '') + p.text;
          last.w = p.x0 + p.w - last.x0;
        } else items.push({ text: p.text, x0: p.x0, w: p.w });
      }
      for (const i of items) i.text = i.text.replace(/\s+/g, ' ').trim();
      return { text: items.map(i => i.text).join('   '), items };
    });
  }

  async function* pages(doc, { maxPages = 8, maxScanned = 6, renderSide = 2600 } = {}) {
    let scanned = 0;
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const lines = textLines(await page.getTextContent(), vp);
      const chars = lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
      if (chars >= 40) yield { page: n, pages: doc.numPages, kind: 'text', ocr: { lines } };
      else if (scanned < maxScanned) {   // no real text on this page: it's a scan, so render it for the OCR reader
        scanned++;
        const v2 = page.getViewport({ scale: renderSide / Math.max(vp.width, vp.height) });
        const c = document.createElement('canvas'); c.width = Math.ceil(v2.width); c.height = Math.ceil(v2.height);
        await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: v2 }).promise;
        yield { page: n, pages: doc.numPages, kind: 'image', canvas: c };
      }
      page.cleanup();
    }
  }

  // Render one page to a canvas, cssWidth wide on screen, sharp on high-density screens.
  async function renderPage(doc, n, cssWidth, dpr = 1) {
    const page = await doc.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, (cssWidth * dpr) / v1.width);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
    page.cleanup();
    return c;
  }
  async function pageSize(doc, n) { const v = (await doc.getPage(n)).getViewport({ scale: 1 }); return { w: v.width, h: v.height }; }
  async function close(doc) { try { await (doc.__task ? doc.__task.destroy() : doc.cleanup && doc.cleanup()); } catch {} }
  window.TijoriPDF = { open, pages, close, renderPage, pageSize };
})();
