/* Minimal PP-OCR (PaddleOCR) pipeline for the browser using onnxruntime-web.
   Detection (DB) -> rotated text boxes -> recognition (CTC).  No network: model bytes are passed in.
   Exposes window.TijoriOCR = { init(opts), recognize(imageBitmapOrCanvas) }  */
(function () {
  'use strict';
  let detSession = null, recSession = null, dict = null, ortRef = null;

  async function init({ ort, detModel, recModel, dictText, wasmPaths }) {
    ortRef = ort;
    ort.env.wasm.numThreads = 1;            // no cross-origin isolation on static hosting
    ort.env.wasm.proxy = false;
    if (wasmPaths) ort.env.wasm.wasmPaths = wasmPaths;
    const so = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    detSession = await ort.InferenceSession.create(detModel, so);
    recSession = await ort.InferenceSession.create(recModel, so);
    dict = dictText.split(/\r?\n/).filter(x => x !== '');   // the dictionary must line up exactly with the model's classes
    dict.push(' ');
  }

  function toCanvas(src, maxSide) {
    const w0 = src.width, h0 = src.height;
    const s = Math.min(1, maxSide / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- detection ---------- */
  async function detect(canvas) {
    const W = canvas.width, H = canvas.height;
    const rw = Math.max(32, Math.round(W / 32) * 32), rh = Math.max(32, Math.round(H / 32) * 32);
    const c = document.createElement('canvas'); c.width = rw; c.height = rh;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, rw, rh);
    const px = g.getImageData(0, 0, rw, rh).data;
    const n = rw * rh, input = new Float32Array(3 * n);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let i = 0; i < n; i++) {               // BGR channel order, as PaddleOCR trains with cv2
      const r = px[i * 4] / 255, gg = px[i * 4 + 1] / 255, b = px[i * 4 + 2] / 255;
      input[i] = (b - mean[0]) / std[0];
      input[n + i] = (gg - mean[1]) / std[1];
      input[2 * n + i] = (r - mean[2]) / std[2];
    }
    const feeds = {}; feeds[detSession.inputNames[0]] = new ortRef.Tensor('float32', input, [1, 3, rh, rw]);
    const out = (await detSession.run(feeds))[detSession.outputNames[0]];
    const prob = out.data; // [1,1,rh,rw]
    const sx = W / rw, sy = H / rh;
    return boxesFromProb(prob, rw, rh).map(b => ({ ...b, cx: b.cx * sx, cy: b.cy * sy, L: b.L * Math.hypot(Math.cos(b.ang) * sx, Math.sin(b.ang) * sy), T: b.T * Math.hypot(Math.sin(b.ang) * sx, Math.cos(b.ang) * sy) }));
  }

  let lastStats = { elongated: 0, vertical: 0 };
  function boxesFromProb(prob, w, h) {
    const thr = 0.3, boxThr = 0.55, unclip = 1.6; let elongated = 0, vertical = 0;
    const lab = new Int32Array(w * h).fill(-1);
    const boxes = [];
    const stack = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (prob[start] <= thr || lab[start] !== -1) continue;
      let sp = 0; stack[sp++] = start; lab[start] = start;
      let cnt = 0, sum = 0, mx = 0, my = 0, mxx = 0, myy = 0, mxy = 0;
      const pts = [];
      while (sp) {
        const p = stack[--sp]; const x = p % w, y = (p / w) | 0;
        cnt++; sum += prob[p]; mx += x; my += y; mxx += x * x; myy += y * y; mxy += x * y; pts.push(p);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx; if (lab[q] === -1 && prob[q] > thr) { lab[q] = start; stack[sp++] = q; }
        }
      }
      if (cnt < 12) continue;
      const score = sum / cnt; if (score < boxThr) continue;
      const cx = mx / cnt, cy = my / cnt;
      const vxx = mxx / cnt - cx * cx, vyy = myy / cnt - cy * cy, vxy = mxy / cnt - cx * cy;
      let ang = 0.5 * Math.atan2(2 * vxy, vxx - vyy);
      const major = (vxx + vyy) / 2 + Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy), minor = (vxx + vyy) / 2 - Math.sqrt(((vxx - vyy) / 2) ** 2 + vxy * vxy);
      if (major > 6 * Math.max(minor, 0.5)) { elongated++; if (Math.abs(ang) > Math.PI / 4) vertical++; }   // a line of text, and which way it runs
      if (Math.abs(ang) > Math.PI / 4) ang = 0;  // read near-horizontal text only (sideways photos are rotated by recognizeBest)
      const ca = Math.cos(ang), sa = Math.sin(ang);
      let umin = 1e9, umax = -1e9, vmin = 1e9, vmax = -1e9;
      for (const p of pts) {
        const x = p % w - cx, y = ((p / w) | 0) - cy;
        const u = x * ca + y * sa, v = -x * sa + y * ca;
        if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
      }
      let L = umax - umin + 1, T = vmax - vmin + 1;
      const d = (L * T * unclip) / (2 * (L + T));
      const ucen = (umax + umin) / 2, vcen = (vmax + vmin) / 2;
      L += 2 * d; T += 2 * d;
      if (T < 6 || L < 6) continue;
      boxes.push({ cx: cx + ucen * ca - vcen * sa, cy: cy + ucen * sa + vcen * ca, L, T, ang, score });
    }
    lastStats = { elongated, vertical };
    return boxes;
  }

  /* ---------- recognition ---------- */
  async function recognizeBox(src, b) {
    const H = 48; const ratio = b.L / b.T;
    const Wt = Math.max(16, Math.min(1600, Math.ceil(H * ratio)));
    const c = document.createElement('canvas'); c.width = Wt; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, Wt, H);
    g.setTransform(Wt / b.L, 0, 0, H / b.T, Wt / 2, H / 2);
    g.rotate(-b.ang); g.translate(-b.cx, -b.cy);
    g.drawImage(src, 0, 0);
    const px = g.getImageData(0, 0, Wt, H).data; const n = Wt * H; const input = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      input[i] = (px[i * 4 + 2] / 255 - 0.5) / 0.5;
      input[n + i] = (px[i * 4 + 1] / 255 - 0.5) / 0.5;
      input[2 * n + i] = (px[i * 4] / 255 - 0.5) / 0.5;
    }
    const feeds = {}; feeds[recSession.inputNames[0]] = new ortRef.Tensor('float32', input, [1, 3, H, Wt]);
    const out = (await recSession.run(feeds))[recSession.outputNames[0]];
    const [, Tn, C] = out.dims; const data = out.data; if (C !== dict.length + 1) console.warn('dict/model mismatch', C, dict.length + 1);
    let text = '', last = -1, confSum = 0, confN = 0;
    for (let t = 0; t < Tn; t++) {
      let best = 0, bv = -Infinity;
      for (let k = 0; k < C; k++) { const v = data[t * C + k]; if (v > bv) { bv = v; best = k; } }
      if (best !== 0 && best !== last) { text += dict[best - 1] ?? ''; confSum += bv; confN++; }
      last = best;
    }
    return { text: text.trim(), conf: confN ? confSum / confN : 0 };
  }

  function crop(src, x, y, w, h, maxSide) {
    const s = Math.min(1, maxSide / Math.max(w, h)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d', { willReadFrequently: true }).drawImage(src, x, y, w, h, 0, 0, c.width, c.height); return c;
  }
  async function recognize(src, { maxSide = 1600, onProgress, zoom = true } = {}) {
    let canvas = toCanvas(src, maxSide);
    let boxes = await detect(canvas);
    const stats = lastStats;
    if (zoom && boxes.length) {   // document small in the frame: read the text area at full detail
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const b of boxes) { const r = Math.max(b.L, b.T) / 2; x0 = Math.min(x0, b.cx - r); y0 = Math.min(y0, b.cy - b.T); x1 = Math.max(x1, b.cx + r); y1 = Math.max(y1, b.cy + b.T); }
      const k = src.width / canvas.width, m = 0.06 * Math.max(x1 - x0, y1 - y0);
      x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(canvas.width, x1 + m); y1 = Math.min(canvas.height, y1 + m);
      const frac = ((x1 - x0) * (y1 - y0)) / (canvas.width * canvas.height);
      if (frac < 0.55 && k > 1.05) { canvas = crop(src, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, maxSide); boxes = await detect(canvas); }
    }
    const items = [];
    for (let i = 0; i < boxes.length; i++) {
      const r = await recognizeBox(canvas, boxes[i]);
      if (r.text) items.push({ ...r, cx: boxes[i].cx, cy: boxes[i].cy, w: boxes[i].L, h: boxes[i].T, ang: boxes[i].ang });
      onProgress && onProgress((i + 1) / boxes.length);
    }
    return { items, lines: toLines(items), width: canvas.width, height: canvas.height, vertical: stats.elongated ? stats.vertical / stats.elongated : 0 };
  }

  function toLines(items) {
    // undo the page's overall tilt so items on one printed line share a row
    const angs = items.filter(i => i.w > i.h * 3).map(i => i.ang).sort((a, b) => a - b);
    const skew = angs.length ? angs[angs.length >> 1] : 0; const cs = Math.cos(skew), sn = Math.sin(skew);
    for (const it of items) { const u = it.cx * cs + it.cy * sn, v = -it.cx * sn + it.cy * cs; it.x0 = u - it.w / 2; it.row = v; }
    const sorted = [...items].sort((a, b) => a.row - b.row);
    const lines = [];
    for (const it of sorted) {
      const ln = lines.find(l => Math.abs(l.cy - it.row) < Math.min(l.h, it.h) * 0.55);
      if (ln) { ln.items.push(it); ln.cy = (ln.cy * (ln.items.length - 1) + it.row) / ln.items.length; ln.h = Math.max(ln.h, it.h); }
      else lines.push({ cy: it.row, h: it.h, items: [it] });
    }
    lines.forEach(l => l.items.sort((a, b) => a.x0 - b.x0));
    return lines.sort((a, b) => a.cy - b.cy).map(l => ({ text: l.items.map(i => i.text).join('   '), items: l.items, cy: l.cy }));
  }

  function rotated(src, deg) {
    const w = src.width, h = src.height, c = document.createElement('canvas'); const swap = deg % 180 !== 0;
    c.width = swap ? h : w; c.height = swap ? w : h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.translate(c.width / 2, c.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(src, -w / 2, -h / 2); return c;
  }
  // judge(result) -> { score, good }.  Reads upright first, then sideways/upside-down only if needed.
  async function recognizeBest(src, judge, { maxSide = 1280, onProgress, onRetry } = {}) {
    if (Math.max(src.width, src.height) > 2600) src = toCanvas(src, 2600);   // keep enough detail for zooming, but spare phone memory
    const p = (a, b) => f => onProgress && onProgress(a + f * (b - a));
    const first = await recognize(src, { maxSide, onProgress: p(0, 0.5) });
    let best = { res: first, deg: 0, ...judge(first) };
    if (best.good) { onProgress && onProgress(1); return best; }
    const order = first.vertical > 0.5 ? [90, 270, 180] : [180, 90, 270];
    for (let i = 0; i < order.length; i++) {
      onRetry && onRetry(order[i]);
      const r = await recognize(rotated(src, order[i]), { maxSide, onProgress: p(0.5 + 0.5 * i / order.length, 0.5 + 0.5 * (i + 1) / order.length) });
      const j = judge(r); if (j.score > best.score) best = { res: r, deg: order[i], ...j };
      if (j.good) break;
    }
    onProgress && onProgress(1);
    return best;
  }
  window.TijoriOCR = { init, recognize, recognizeBest };
})();
