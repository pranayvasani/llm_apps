/* Tijori — turn OCR lines into suggested field values, per document type.
   Pure functions, no network, no DOM.  window.TijoriExtract.extract(type, ocr) -> { fields: {k: {value, conf}}, title? }
   ocr = { lines: [{ text, items: [{ text, ... }] }] }  */
(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const pad = n => String(n).padStart(2, '0');
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const stripSep = s => clean(s).replace(/^[\s:;.\-–—=|]+/, '').replace(/[\s:;|,]+$/, '').trim();

  function isoFrom(d, m, y) {
    d = +d; m = +m; y = +y; if (y < 100) y += y > 60 ? 1900 : 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
    const dt = new Date(y, m - 1, d); if (dt.getMonth() !== m - 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }
  // all dates in a string, in order (Indian dd/mm/yyyy convention)
  function dates(s) {
    const out = []; s = String(s || '');
    const re = /(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})|(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})(?!\d)|(\d{1,2})(?:st|nd|rd|th)?[\s\-.]*([A-Za-z]{3,9})[\s\-.,]*(\d{4})/g;
    let m;
    while ((m = re.exec(s))) {
      let iso = null;
      if (m[1]) iso = isoFrom(m[3], m[2], m[1]);
      else if (m[4]) iso = isoFrom(m[4], m[5], m[6]);
      else if (m[7]) { const mo = MONTHS[m[8].toLowerCase().slice(0, m[8].toLowerCase().startsWith('sept') ? 4 : 3)]; if (mo) iso = isoFrom(m[7], mo, m[9]); }
      if (iso) out.push({ iso, index: m.index, end: re.lastIndex });
    }
    return out;
  }
  const firstDate = s => (dates(s)[0] || {}).iso || null;
  function amount(s) {
    s = String(s || '').replace(/(\d)[.\s](?=\d{3}(?:[^\d]|$))/g, '$1,');   // OCR often reads 24,318 as 24.318 or 24 318
    const m = /(?:rs\.?|inr|₹)?\s*([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]{3,}(?:\.[0-9]{1,2})?)/i.exec(s);
    return m ? m[1] : null;
  }
  function phone(s) {
    const m = /(1[- ]?8[06]0[\s-]?\d{2,3}[\s-]?\d{3,4}[\s-]?\d{0,4}|(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|0\d{2,4}[\s-]?\d{6,8})/.exec(String(s || ''));
    return m ? clean(m[1]) : null;
  }
  // OCR confusions when a position must be a letter / a digit
  const toLetter = c => ({ '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A', '7': 'T' }[c] || c);
  const toDigit = c => ({ O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', i: '1', '|': '1', L: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', T: '7', A: '4' }[c] || c);

  /* checksums */
  const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  function verhoeff(num) { let c = 0; const a = String(num).split('').reverse(); for (let i = 0; i < a.length; i++) c = VD[c][VP[i % 8][+a[i]]]; return c === 0; }
  function luhn(num) { let s = 0, alt = false; for (let i = num.length - 1; i >= 0; i--) { let d = +num[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; }

  /* ---------- label lookup ---------- */
  // Find text that follows a label: same item after ':' -> next item on the line -> the line below.
  function lev(a, b) {   // edit distance, for short labels the reader got slightly wrong ("Nare" for "Name")
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  function byLabel(ocr, labelRe, opts = {}) {
    const { below = true, notRe = null, accept = v => !!v, fuzzy = null, squash = null } = opts;
    const L = ocr.lines;
    for (let li = 0; li < L.length; li++) {
      const items = L[li].items && L[li].items.length ? L[li].items : [{ text: L[li].text }];
      for (let ii = 0; ii < items.length; ii++) {
        const t = items[ii].text; let m = labelRe.exec(t);
        if (!m && fuzzy) {   // whole item is a near-miss of a one-word label
          const w = t.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (w.length >= 3 && Math.abs(w.length - fuzzy.length) <= 1 && lev(w, fuzzy) <= 1) m = { index: 0, 0: t };
        }
        if (!m && squash && squash.test(t.toLowerCase().replace(/[^a-z]/g, ''))) m = { index: t.length, 0: '' };   // whole item is a mangled label
        if (!m || (notRe && (notRe.test(t) || notRe.test(t.toLowerCase().replace(/[^a-z]/g, ''))))) continue;
        const rest = stripSep(t.slice(m.index + m[0].length));
        if (rest && accept(rest)) return rest;
        // "Plan | Policy Start | Policy Expiry" with values underneath: the neighbours are labels too, not values
        const labelish = x => !/\d/.test(x) && !/:/.test(x) && x.trim().split(/\s+/).length <= 4;
        const LABEL_WORD = /\b(date|issue|expiry|valid\w*|start|end|from|till|upto|number|no|name|plan|premium|sum|amount|type|class|group|donor|code|period|policy|insured|nominee|branch|ifsc|status|birth|dob|doi|gender|sex|blood|organ|mode|term|tenure|cover)\b/i;
        const headerRow = items.length >= 2 && items.every(x => labelish(x.text)) && (items.length >= 3 || items.every(x => LABEL_WORD.test(x.text))) &&
          L[li + 1] && (L[li + 1].items || []).some(x => /\d|[A-Za-z]{2}/.test(x.text));
        const next = headerRow ? '' : items.slice(ii + 1).map(x => x.text).join(' ');
        const nv = stripSep(next);
        if (nv && accept(nv)) return nv;
        if (below && L[li + 1]) {
          // value printed under the label: take the item in the next line that sits below it, not just the first one
          const it = items[ii], nItems = L[li + 1].items && L[li + 1].items.length ? L[li + 1].items : [{ text: L[li + 1].text }];
          let pick = nItems[0];
          if (it.x0 != null && it.w && nItems.every(n => n.x0 != null)) {
            const lc = it.x0 + it.w * Math.min(1, (m.index + m[0].length / 2) / Math.max(1, t.length));   // centre of the label text
            pick = nItems.reduce((a, n) => Math.abs(n.x0 + n.w / 2 - lc) < Math.abs(a.x0 + a.w / 2 - lc) ? n : a);
          }
          const bv = stripSep(pick.text);
          if (bv && accept(bv)) return bv;
        }
      }
    }
    return null;
  }
  const allText = ocr => ocr.lines.map(l => l.text).join('\n');
  const isNameLike = v => /^[A-Za-z][A-Za-z .'\-]{2,40}$/.test(v) && v.split(/\s+/).length <= 5 && !/\d/.test(v);
  const titleCase = s => s.toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
  const nameOut = v => v && (v === v.toUpperCase() ? v : titleCase(v));

  function insurerName(ocr) {
    for (const l of ocr.lines) {
      for (const it of (l.items || [{ text: l.text }])) {
        const t = clean(it.text);
        if (/(insurance|assurance|life|general|health|allianz|lombard|ergo|bupa|star|niva|care|digit|acko|tata aig|hdfc|icici|sbi|bajaj|lic\b)/i.test(t) && /(insurance|assurance|ltd|limited|company|co\.)/i.test(t) && t.length < 80 && !/(policy|schedule|premium|period|insured|sum)/i.test(t))
          return t.replace(/\b(company|co\.?)\b.*$/i, m => m).replace(/\s*(limited|ltd\.?)\s*$/i, '').replace(/\s+company$/i, '').trim();
      }
    }
    return null;
  }
  const BANKS = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'SBI Card', 'SBI', 'Axis Bank', 'Kotak Mahindra Bank', 'Kotak', 'IDFC FIRST Bank', 'Yes Bank', 'IndusInd Bank', 'AU Small Finance Bank', 'RBL Bank', 'Bank of Baroda', 'Punjab National Bank', 'Canara Bank', 'Union Bank of India', 'Bank of India', 'Indian Bank', 'Central Bank of India', 'Federal Bank', 'South Indian Bank', 'Karnataka Bank', 'IDBI Bank', 'HSBC', 'Standard Chartered', 'Citibank', 'American Express', 'DBS Bank', 'Bandhan Bank', 'OneCard', 'Paytm Payments Bank', 'Airtel Payments Bank', 'Saraswat Bank'];
  function bankName(text) {
    const T = text.toUpperCase();
    for (const b of BANKS) if (T.includes(b.toUpperCase())) return b;
    const m = /([A-Z][A-Za-z&.]+(?:\s[A-Z][A-Za-z&.]+){0,3}\s(?:BANK|Bank))/.exec(text); return m ? clean(m[1]) : null;
  }
  const BRANDS = ['Samsung', 'LG', 'Sony', 'Whirlpool', 'Bosch', 'IFB', 'Godrej', 'Voltas', 'Daikin', 'Blue Star', 'Hitachi', 'Carrier', 'Panasonic', 'Haier', 'Apple', 'OnePlus', 'Xiaomi', 'Redmi', 'Realme', 'Oppo', 'Vivo', 'Motorola', 'Google', 'Philips', 'Bajaj', 'Havells', 'Crompton', 'Usha', 'Prestige', 'Butterfly', 'Kent', 'Aquaguard', 'Eureka Forbes', 'Dell', 'HP', 'Lenovo', 'Asus', 'Acer', 'Canon', 'Nikon', 'Bose', 'JBL', 'Boat', 'TCL', 'Mi', 'Kenstar', 'Lloyd', 'Onida', 'Videocon', 'Siemens', 'Electrolux', 'Dyson', 'Midea', 'Toshiba'];
  function brandIn(text) { for (const b of BRANDS) if (new RegExp(`\\b${b.replace(/ /g, '\\s')}\\b`, b.length <= 3 ? '' : 'i').test(text)) return b; return null; }

  /* ---------- per-field finders ---------- */
  function panNumber(text) {
    const fix = c => c.split('').map((ch, i) => (i < 5 || i === 9) ? toLetter(ch) : toDigit(ch)).join('');
    const U = text.toUpperCase();
    for (const c of (U.match(/\b[A-Z0-9]{10}\b/g) || [])) { const fx = fix(c); if (/^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(fx)) return { value: fx, conf: 'high' }; }
    // number split by a stray space or glued to a label: slide along lines that contain digits
    for (const line of U.split('\n')) {
      const s = line.replace(/[^A-Z0-9]/g, ''); if ((s.match(/\d/g) || []).length < 3) continue;
      for (let i = 0; i + 10 <= s.length; i++) { const fx = fix(s.slice(i, i + 10)); if (/^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/.test(fx)) return { value: fx, conf: 'high' }; }
    }
    for (const c of (U.match(/\b[A-Z0-9]{10}\b/g) || [])) { const fx = fix(c); if (/^[A-Z]{5}\d{4}[A-Z]$/.test(fx)) return { value: fx, conf: 'medium' }; }
    return null;
  }
  function aadhaarNumber(text) {
    const re = /(?<!\d)([2-9OSBIlZ]\S{3})[\s-]?(\S{4})[\s-]?(\S{4})(?!\d)/g; let m;
    const t = text.replace(/[^\S\n]+/g, ' ');
    while ((m = re.exec(t))) {
      const d = (m[1] + m[2] + m[3]).split('').map(toDigit).join('');
      if (/^[2-9]\d{11}$/.test(d)) return { value: `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`, conf: verhoeff(d) ? 'high' : 'low' };
    }
    return null;
  }
  function cardNumber(text) {
    const t = text.replace(/[^\S\n]+/g, ' ');
    const re = /(?<![\dA-Z])((?:[\dOSBIlZ]{4}[ -]?){3}[\dOSBIlZ]{1,7})(?![\dA-Z])/g; let m;
    while ((m = re.exec(t))) {
      const d = m[1].replace(/[ -]/g, '').split('').map(toDigit).join('');
      if (/^\d{13,19}$/.test(d) && luhn(d)) return { value: d, conf: 'high' };
    }
    const m2 = /(?<!\d)((?:\d{4} ?){3}\d{4})(?!\d)/.exec(t);
    return m2 ? { value: m2[1].replace(/\D/g, ''), conf: 'low' } : null;
  }
  function vehicleReg(text) {
    const m = /\b([A-Z]{2})[\s-]?(\d{1,2})[\s-]?([A-Z]{1,3})[\s-]?(\d{1,4})\b/.exec(text.toUpperCase());
    return m ? { value: `${m[1]} ${m[2].padStart(2, '0')} ${m[3]} ${m[4].padStart(4, '0')}`, conf: 'high' } : null;
  }
  function dlNumber(text) {
    // state code + RTO (2 digits) + year (4) + 7 digits, e.g. MH12 20180045678. Fix common letter/digit mix-ups in the digit part.
    for (const line of text.toUpperCase().split('\n')) {
      const m = /\b([A-Z]{2})[\s\-\/]?([0-9OISBZ]{2})[\s\-\/]?([0-9OISBZ]{4})[\s\-\/]?([0-9OISBZ]{7})\b/.exec(line);
      if (m) { const d = (m[2] + m[3] + m[4]).split('').map(toDigit).join(''); if (/^\d{13}$/.test(d) && /^(19|20)/.test(d.slice(2, 4))) return { value: `${m[1]}${d.slice(0, 2)} ${d.slice(2)}`, conf: 'high' }; }
    }
    const m2 = /\b([A-Z]{2}[\s\-]?\d{2}[\s\-\/]?\d{6,11})\b/.exec(text.toUpperCase());
    return m2 ? { value: clean(m2[1]), conf: 'medium' } : null;
  }
  function ifsc(text) {
    const cands = text.toUpperCase().match(/\b[A-Z0-9]{11}\b/g) || [];
    for (const c of cands) { const f = c.slice(0, 4).split('').map(toLetter).join('') + toDigit(c[4]) + c.slice(5); if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f)) return { value: f, conf: 'high' }; }
    return null;
  }
  function mmyy(text, ocr) {
    const near = byLabel(ocr, /(valid\s*thru|valid\s*upto|expiry|exp\.?\s*date|expires|good\s*thru|valid\s*till)/i, { accept: v => /\d{2}\s*\/\s*\d{2}/.test(v) });
    const pick = s => { const m = /(?<!\d)(0[1-9]|1[0-2])\s*\/\s*(\d{2})(?!\d)/.exec(s || ''); return m ? `${m[1]}/${m[2]}` : null; };
    const v = pick(near); if (v) return { value: v, conf: 'high' };
    const all = [...text.matchAll(/(?<![\d\/])(0[1-9]|1[0-2])\s*\/\s*(\d{2})(?![\d\/])/g)].map(m => `${m[1]}/${m[2]}`);
    if (!all.length) return null;
    all.sort((a, b) => (+b.slice(3) * 12 + +b.slice(0, 2)) - (+a.slice(3) * 12 + +a.slice(0, 2)));   // latest = expiry (vs "valid from")
    return { value: all[0], conf: all.length === 1 ? 'high' : 'medium' };
  }
  function periodDates(ocr) {   // "Period of Insurance: From 05/01/2026 To 04/01/2027"
    const t = byLabel(ocr, /(period\s*of\s*(insurance|cover)|policy\s*period|insurance\s*period|cover\s*period)/i, { accept: v => dates(v).length >= 1 });
    const ds = dates(t || ''); if (ds.length >= 2) return { start: ds[0].iso, end: ds[ds.length - 1].iso };
    const full = allText(ocr); const m = /from[^0-9]{0,15}([0-9][^\n]{5,30}?)\s*(?:to|till|upto|-)\s*([0-9][^\n]{5,30})/i.exec(full);
    if (m) { const a = firstDate(m[1]), b = firstDate(m[2]); if (a && b) return { start: a, end: b }; }
    return null;
  }
  const dateAfter = (ocr, re, opts) => { const v = byLabel(ocr, re, { accept: x => !!firstDate(x), ...(opts || {}) }); return v ? firstDate(v) : null; };
  const amountAfter = (ocr, re) => { const v = byLabel(ocr, re, { accept: x => !!amount(x) }); return v ? amount(v) : null; };
  const phoneAfter = (ocr, re) => { const v = byLabel(ocr, re, { accept: x => !!phone(x) }); return v ? phone(v) : null; };
  const textAfter = (ocr, re, opts) => byLabel(ocr, re, opts);
  const idAfter = (ocr, re, minLen = 4) => { const v = byLabel(ocr, re, { accept: x => /[0-9]/.test(x) && x.replace(/[^A-Za-z0-9]/g, '').length >= minLen }); return v ? v.replace(/^(no|number|num|#)\.?\s*[:\-]?\s*/i, '').split(/\s{2,}| (?=[A-Za-z]+\s*:)/)[0].replace(/[ ,;]+$/, '') : null; };

  function icao(s) { const w = [7, 3, 1]; let t = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; t += (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55) * w[i % 3]; } return String(t % 10); }
  function mrz(text, ocr) {   // passport machine-readable zone (the two lines full of <<<)
    const raw = ocr ? ocr.lines.map(l => (l.items && l.items.length ? l.items.map(i => i.text).join('') : l.text)) : text.split('\n');
    const lines = raw.map(l => l.toUpperCase().replace(/\s/g, '').replace(/[«‹(\[{]/g, '<')).filter(l => (l.match(/</g) || []).length >= 3 && l.length >= 28);
    let p2 = null, l2 = null;
    for (const l of lines) {
      const dob = l.slice(13, 19).split('').map(toDigit).join(''), exp = l.slice(21, 27).split('').map(toDigit).join('');
      const nat = l.slice(10, 13).split('').map(toLetter).join('');
      if (!/^\d{6}$/.test(dob) || !/^\d{6}$/.test(exp) || !/^[A-Z<]{3}$/.test(nat)) continue;
      let num = l.slice(0, 9).replace(/<+$/, '');
      if (/^[A-Z0-9OILSZB]\d{7}$/.test(num.slice(0, 1) + num.slice(1).split('').map(toDigit).join(''))) num = toLetter(num[0]) + num.slice(1).split('').map(toDigit).join('');
      const ok = icao(dob) === toDigit(l[19]) && icao(exp) === toDigit(l[27]);
      p2 = { num, numOk: icao(l.slice(0, 9).replace(/O/g, '0')) === toDigit(l[9]) || icao(num.padEnd(9, '<')) === toDigit(l[9]), dob, exp, ok, nat }; l2 = l; break;
    }
    if (!p2) return null;
    const yy = (s, future) => { const y = +s.slice(0, 2); const full = future ? 2000 + y : (y > (new Date().getFullYear() % 100) ? 1900 + y : 2000 + y); return `${full}-${s.slice(2, 4)}-${s.slice(4, 6)}`; };
    const out = { number: p2.num, numOk: p2.numOk, dob: yy(p2.dob, false), expiry: yy(p2.exp, true), ok: p2.ok };
    const l1 = lines.find(l => l !== l2 && /^P[A-Z0-9<]/.test(l) && l.slice(5).includes('<<'));
    if (l1) {
      const nm = l1.slice(5).split('').map(c => (c === '<' ? c : toLetter(c))).join('').split('<<').filter(Boolean);
      const sur = (nm[0] || '').replace(/</g, ' ').trim(), giv = (nm[1] || '').replace(/</g, ' ').trim();
      if (sur || giv) out.name = clean(`${giv} ${sur}`);
    }
    return out;
  }
  const CITY = /^[A-Z][A-Z .,'\-]{2,30}$/;
  function addMonthsIso(iso, n) {   // warranty of n months from a purchase date ends the day before the same date n months later
    const [y, m, d] = iso.split('-').map(Number); const r = new Date(y, m - 1, 1); r.setMonth(r.getMonth() + n);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate(); r.setDate(Math.min(d, last)); r.setDate(r.getDate() - 1);
    return `${r.getFullYear()}-${pad(r.getMonth() + 1)}-${pad(r.getDate())}`;
  }
  const fmtIso = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18, twenty: 20, 'twenty four': 24, thirty: 30, 'thirty six': 36 };
  const PART = /(compressor|motor|panel|display|magnetron|inverter|drum|battery|tube|picture\s*tube|heating\s*element|element|pump|engine|screen)/i;
  // Warranty terms anywhere on the document: main duration, extended, per-part durations, or an end date printed outright.
  function warrantyTerms(o, T) {
    const out = { months: null, until: null, extended: null, extendedMonths: 0, parts: [] };
    const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen|twenty(?:\\s*four)?|thirty(?:\\s*six)?)';
    const UNIT = '(years?|yrs?|y(?=\\b)|months?|mths?|mos?|m(?=\\b))';
    const toN = x => /^\d+$/.test(x) ? +x : WORDNUM[x.toLowerCase().replace(/\s+/g, ' ')] || 0;
    const toM = (n, u) => /^y/i.test(u) ? n * 12 : n;
    for (const l of o.lines) {
      const t = clean(l.text); if (!/warrant|guarantee/i.test(t)) continue;
      // an end date printed outright: "Warranty valid till 31/12/2027", "Warranty expires on ..."
      if (/(valid|upto|up\s*to|till|until|expir|ends?\b|end\s*date)/i.test(t)) { const ds = dates(t); if (ds.length) { out.until = out.until || ds[ds.length - 1].iso; continue; } }
      // "1+1 year": standard plus extended
      const plus = new RegExp(NUM + '\\s*\\+\\s*' + NUM + '\\s*' + UNIT, 'i').exec(t);
      if (plus && !PART.test(t)) { const a = toN(plus[1]), b = toN(plus[2]); if (a && b && !out.months) { out.months = toM(a + b, plus[3]); out.extendedMonths = toM(b, plus[3]); out.extended = `${b} ${/^y/i.test(plus[3]) ? (b > 1 ? 'years' : 'year') : 'months'} extended (included)`; } continue; }
      // every "<n> <unit>", judged within its own clause ("1 year on product, 10 years on compressor")
      for (const clause of t.split(/[,;]|\band\b/i)) {
        const re = new RegExp('\\b' + NUM + '\\s*[-–]?\\s*' + UNIT + '\\b', 'gi'); let m;
        const part = PART.exec(clause), ext = /extend/i.test(clause);
        while ((m = re.exec(clause))) {
          const n = toN(m[1]); if (!n || n > 120) continue;
          const months = toM(n, m[2]); if (months > 180) continue;
          const unitTxt = `${n} ${/^y/i.test(m[2]) ? (n > 1 ? 'years' : 'year') : (n > 1 ? 'months' : 'month')}`;
          if (part) { const name = part[1].replace(/\s+/g, ' ').replace(/^./, c => c.toUpperCase()); if (!out.parts.some(p => p.part === name)) out.parts.push({ part: name, months, text: unitTxt }); }
          else if (ext) { if (!out.extended) out.extended = unitTxt + ' extended'; }
          else if (!out.months) out.months = months;
        }
      }
    }
    // "Warranty Period" label with the duration on the line below
    if (!out.months) { const v = textAfter(o, /warranty\s*(period|term|duration)?/i, { accept: x => new RegExp(NUM + '\\s*' + UNIT, 'i').test(x) }); if (v) { const m = new RegExp(NUM + '\\s*' + UNIT, 'i').exec(v); out.months = toM(toN(m[1]), m[2]); } }
    return out;
  }
  /* ---------- per-type extractors ---------- */
  const X = {
    pan(o, T) {
      let name = textAfter(o, /^(name|नाम\s*\/\s*name)\b/i, { notRe: /father/i, accept: isNameLike, fuzzy: 'name' });
      let father = textAfter(o, /father'?s\s*name/i, { accept: isNameLike });
      // fallback on the card's fixed layout: number, then holder's name, then father's name
      const num = panNumber(T);
      if (!name || !father) {
        const L = o.lines.map(l => clean(l.text));
        const at = num ? L.findIndex(l => l.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(num.value.slice(0, 5))) : -1;
        const person = l => /^[A-Z][A-Z .']{2,40}$/.test(l) && l.split(' ').length >= 2 && !/(NAME|FATHER|BIRTH|SIGNATURE|DEPARTMENT|INDIA|CARD|INCOME|GOVT|PERMANENT|ACCOUNT|NUMBER|TAX)/.test(l);
        let people = at >= 0 ? L.slice(at + 1).filter(person) : [];
        if (!people.length) {   // older cards: no labels; name and father's name are the two lines right above the date of birth
          const di = L.findIndex(l => !!firstDate(l));
          if (di > 0) people = L.slice(Math.max(0, di - 2), di).filter(l => person(l) && l.split(' ').every(w => w.length >= 2));
        }
        if (!name && people[0]) name = people[0];
        if (!father && people[1] && people[1] !== name) father = people[1];
      }
      return { number: num, name, father, dob: dateAfter(o, /(date\s*of\s*birth|dob)/i) || firstDate(T) };
    },
    aadhaar(o, T) {
      let name = null; const L = o.lines.map(l => clean(l.text));
      const di = L.findIndex(l => /(dob|date of birth|year of birth|yob)/i.test(l));
      for (let i = di - 1; i >= 0 && i >= di - 3; i--) if (isNameLike(L[i]) && !/(government|india|aadhaar|unique|authority)/i.test(L[i])) { name = L[i]; break; }
      return { number: aadhaarNumber(T), name, dob: dateAfter(o, /(dob|date\s*of\s*birth)/i) || firstDate(T), mobile: phoneAfter(o, /mobile|mob\.?/i) };
    },
    passport(o, T) {
      const z = mrz(T, o);
      // number: from the machine-readable lines, else only next to a "Passport No." label. Never the "Old Passport No." on the last page.
      const OLD = /\bold\b|oldpas/i;
      const numLbl = byLabel(o, /pass?port\s*n[o0]/i, { notRe: OLD, accept: v => /\b[A-Z][0-9]{7}\b/.test(v.toUpperCase()) });
      const num = z && z.number ? { value: z.number, conf: z.numOk ? 'high' : 'medium' } : numLbl ? { value: /\b[A-Z][0-9]{7}\b/.exec(numLbl.toUpperCase())[0], conf: 'medium' } : null;
      const expiry = (z && z.ok && z.expiry) || dateAfter(o, /date\s*of\s*expiry/i, { squash: /dateofexp/ }) || (z && z.expiry) || null;
      const dob = z && z.dob;
      // date of issue: labelled, else the other date on the same row as the expiry date
      let issue = dateAfter(o, /date\s*of\s*[il1|]?ss?ue/i, { squash: /dateof[il1]?ss?ue/, notRe: OLD });
      const L = o.lines; const expIso = expiry;
      let row = -1;
      if (expIso) row = L.findIndex(l => dates(l.text).some(d => d.iso === expIso));
      if (!issue && row >= 0) { const c = dates(L[row].text).map(d => d.iso).filter(d => d !== expIso && d !== dob && d < expIso); if (c.length) issue = c[0]; }
      if (issue && expIso && issue >= expIso) issue = null;
      // place of issue: labelled, else the capital-letters line just above that date row
      let place = textAfter(o, /pl?ace\s*of\s*[il1|]?ss?ue/i, { squash: /(pl)?aceof[il1]?ss?u/, notRe: OLD, accept: v => CITY.test(v.toUpperCase()) && !/\d/.test(v) });
      if (!place && row > 0) for (let k = row - 1; k >= Math.max(0, row - 3); k--) { const t = clean(L[k].text); if (CITY.test(t) && !/(INDIA|REPUBLIC|PASSPORT|NATIONALITY)/.test(t) && !/,/.test(t)) { place = t; break; } }
      let name = z && z.name ? z.name : null;
      if (!name) { const g = textAfter(o, /given\s*name/i, { squash: /givenname/, accept: isNameLike }), sn = textAfter(o, /surname/i, { squash: /su[rn]n?ame/, accept: isNameLike }); name = [g, sn].filter(Boolean).join(' ') || null; }
      return { number: num, name, fileno: byLabel(o, /\bfi[l1i]?e\s*n[o0]/i, { squash: /fi[l1i]?en[o0]/, accept: v => /^[A-Z]{2}\d{6,}/i.test(v.replace(/[\s.:]/g, '')) }), place: place ? place.toUpperCase() : null, issue, expiry };
    },
    voter(o, T) {
      const m = /\b([A-Z]{3})(\d{7})\b/.exec(T.toUpperCase().replace(/[^\S\n]+/g, ''));
      return { number: m ? { value: m[1] + m[2], conf: 'high' } : null, name: textAfter(o, /(elector'?s\s*name|name)/i, { notRe: /(father|husband|mother)/i, accept: isNameLike }) };
    },
    id_other(o, T) { return { number: idAfter(o, /(id\s*no|number|no\.)/i), name: textAfter(o, /name/i, { accept: isNameLike }), expiry: dateAfter(o, /(valid|expiry|expires)/i) }; },
    dl(o, T) {
      const cov = textAfter(o, /(cov|class(es)?\s*of\s*vehicle|vehicle\s*class|authori[sz]ation\s*to\s*drive)/i, { accept: v => /\b(LMV|MCWG|MCWOG|HMV|HGMV|HPMV|MGV|TRANS|LMV-?NT|INVCRG|e-?RICKSHAW|MC\s?50CC|3W)\b/i.test(v) });
      // classes are often listed one per line under the label, so collect them from the whole card
      const classes = ((cov || '') + '\n' + T).toUpperCase().match(/\b(LMV-?NT|LMV-?TR|LMV|MCWG|MCWOG|HMV|HGMV|HPMV|MGV|TRANS|INVCRG|E-?RICKSHAW|MC\s?50CC)\b/g);
      let issue = dateAfter(o, /(date\s*of\s*first\s*[il1|]?ssue|first\s*[il1|]?ssue|date\s*of\s*[il1|]?ssue|[il1|]?ssue\s*date|issued\s*on|\bdoi\b)/i);
      let expiry = dateAfter(o, /(valid(ity)?\s*\(?\s*n\.?\s*t\b|non[\s-]*transport|valid\s*till|valid\s*up\s*to|valid\s*upto|validity|\bvalid\b)/i);
      const ds = [...new Set(dates(T).map(d => d.iso))].sort();
      if (!expiry && ds.length >= 2) expiry = ds[ds.length - 1];
      if (issue && expiry && expiry <= issue) { const later = ds.filter(d => d > issue); expiry = later.length ? later[later.length - 1] : null; }   // validity always comes after issue
      const rto = textAfter(o, /(issuing\s*authority|licensing\s*authority|\brto\b)/i, { accept: v => /[A-Za-z]{3}/.test(v) });
      const byLbl = idAfter(o, /(d\.?\s*l\.?\s*(no|number)|licen[cs]e\s*(no|number))/i, 10);
      const num = dlNumber(T) || (byLbl ? { value: byLbl.toUpperCase(), conf: 'medium' } : null);
      return { number: num, name: textAfter(o, /^name\b/i, { accept: isNameLike, fuzzy: 'name' }), classes: classes ? [...new Set(classes)].join(', ') : null, rto: rto ? rto.toUpperCase().replace(/^.*?(?=\b(RTO|DTO|ARTO))/, '').replace(/^(ARTO|RTO|DTO)(?=[A-Z])/, '$1 ') : null, issue, expiry };
    },
    rc(o, T) {
      return { reg: vehicleReg(T), model: textAfter(o, /(maker'?s?\s*(name|class)?|model|make)/i, { accept: v => v.length > 2 }), owner: textAfter(o, /owner'?s?\s*name|owner/i, { accept: isNameLike }), chassis: (m => m ? { value: m[0], conf: 'high' } : idAfter(o, /chassis|vin/i, 10))(/\b[A-HJ-NPR-Z0-9]{17}\b/.exec(T.toUpperCase())), engine: idAfter(o, /engine/i, 5), regdate: dateAfter(o, /(reg(n|istration)?\.?\s*date|date\s*of\s*reg)/i), expiry: dateAfter(o, /(reg(n|istration)?\.?\s*(valid|upto)|valid\s*upto|fitness\s*upto)/i) };
    },
    motor_ins(o, T) {
      const p = periodDates(o);
      const ncb = textAfter(o, /\bncb\b|no\s*claim\s*bonus/i, { accept: v => /\d{1,2}\s*%/.test(v) });
      return { insurer: insurerName(o), policy: idAfter(o, /policy\s*(no|number|#)/i, 6), reg: vehicleReg(T), idv: amountAfter(o, /\bidv\b|insured\s*declared\s*value/i), premium: amountAfter(o, /(total|gross|net)?\s*premium/i), ncb: ncb ? (/(\d{1,2})\s*%/.exec(ncb) || [])[1] + '%' : null, claim: phoneAfter(o, /(claim|toll\s*free|helpline|customer\s*care)/i) || phone(T), expiry: (p && p.end) || dateAfter(o, /(expiry|valid\s*till|end\s*date|to\s*date|till)/i) };
    },
    puc(o, T) { return { cert: idAfter(o, /(certificate|puc|puc?c)\s*(sl\.?\s*)?(no|number)/i, 5), reg: vehicleReg(T), expiry: dateAfter(o, /(valid(ity)?\s*(upto|till|date)?|expiry)/i) }; },
    credit(o, T) {
      let holder = null;
      for (const l of o.lines) for (const it of (l.items || [{ text: l.text }])) {
        const t = clean(it.text);
        if (!holder && /^[A-Z][A-Z .']{3,30}$/.test(t) && t.split(' ').length >= 2 && t.split(' ').length <= 4 && !/(BANK|CARD|VALID|THRU|VISA|MASTER|RUPAY|PLATINUM|SIGNATURE|DEBIT|CREDIT|MEMBER|SINCE|WORLD|SELECT|INFINITE|GOLD|CLASSIC|TITANIUM|BUSINESS|CORPORATE|AMERICAN|EXPRESS|INTERNATIONAL|ELECTRONIC|USE ONLY)/.test(t)) holder = t;
      }
      return { bank: bankName(T), number: cardNumber(T), holder, exp: mmyy(T, o), care: phoneAfter(o, /(customer\s*care|helpline|toll\s*free|call)/i) };
    },
    health(o, T) {
      const p = periodDates(o);
      return { insurer: insurerName(o), plan: textAfter(o, /(plan|product)\s*(name)?\b(?!\s*no)/i, { accept: v => v.length > 2 && !/^\d/.test(v) }), policy: idAfter(o, /policy\s*(no|number|#)/i, 6), sum: amountAfter(o, /sum\s*insured|coverage\s*amount/i), premium: amountAfter(o, /(total|gross|net|annual)\s*premium|premium\s*(amount|paid)?/i), members: textAfter(o, /insured\s*(members|persons?)|members\s*covered/i, { accept: v => /[A-Za-z]{3}/.test(v) }), tpa: phoneAfter(o, /(cashless|tpa|helpline|toll\s*free|customer\s*care)/i), agent: textAfter(o, /(agent|intermediary|advisor)\s*(name)?/i, { accept: v => /[A-Za-z]{3}/.test(v) }), start: (p && p.start) || dateAfter(o, /(policy\s*start|start\s*date|commencement|inception)/i), expiry: (p && p.end) || dateAfter(o, /(expiry|end\s*date|renewal\s*date|valid\s*till)/i) };
    },
    life(o, T) {
      return { insurer: insurerName(o), plan: textAfter(o, /(plan|product)\s*(name)?/i, { accept: v => v.length > 2 && !/^\d/.test(v) }), policy: idAfter(o, /policy\s*(no|number|#)/i, 6), sum: amountAfter(o, /sum\s*assured|cover\s*amount|death\s*benefit/i), premium: amountAfter(o, /(installment|instalment|modal|annual|total)?\s*premium/i), freq: (m => m ? titleCase(m[1]) : null)(/\b(yearly|annual|half[\s-]?yearly|quarterly|monthly|single)\b/i.exec(T)), nominee: textAfter(o, /nominee\s*(name)?/i, { accept: isNameLike }), maturity: dateAfter(o, /(maturity|expiry|cover\s*(ceases|ends))/i), expiry: dateAfter(o, /(next\s*(premium)?\s*due|due\s*date|fup|first\s*unpaid)/i) };
    },
    home_ins(o, T) { const p = periodDates(o); return { insurer: insurerName(o), policy: idAfter(o, /policy\s*(no|number|#)/i, 6), property: textAfter(o, /(risk\s*location|property|address\s*of\s*premises|location)/i, { accept: v => v.length > 5 }), sum: amountAfter(o, /sum\s*insured/i), premium: amountAfter(o, /premium/i), expiry: (p && p.end) || dateAfter(o, /(expiry|end\s*date|valid\s*till)/i) }; },
    travel(o, T) { const p = periodDates(o); return { insurer: insurerName(o), policy: idAfter(o, /policy\s*(no|number|#)/i, 6), trip: textAfter(o, /(destination|geography|trip)/i, { accept: v => v.length > 2 }), travellers: textAfter(o, /(traveller|insured\s*person|name\s*of\s*insured)/i, { accept: v => /[A-Za-z]{3}/.test(v) }), helpline: phoneAfter(o, /(assistance|emergency|helpline|toll)/i), start: (p && p.start) || dateAfter(o, /(start|departure|from)/i), expiry: (p && p.end) || dateAfter(o, /(end|return|to\b|till)/i) }; },
    warranty(o, T) {
      const purchase = dateAfter(o, /(invoice\s*date|bill\s*date|purchase\s*date|date\s*of\s*purchase|date)/i, { notRe: /(valid|till|upto|expir)/i });
      const w = warrantyTerms(o, T);
      let expiry = w.until ? { value: w.until, conf: 'high', hint: 'End date printed on the document' } : null;
      if (!expiry && purchase && w.months) expiry = { value: addMonthsIso(purchase, w.months), conf: 'medium', hint: `Worked out: purchase date + ${w.months % 12 ? w.months + ' months' : (w.months / 12) + (w.months === 12 ? ' year' : ' years')}${w.extendedMonths ? ' (includes extended warranty)' : ''}` };
      const custom = w.parts.map(pt => ({ l: `${pt.part} warranty`, v: `${pt.text}${purchase ? ` (till ${fmtIso(addMonthsIso(purchase, pt.months))})` : ''}` }));
      const item = textAfter(o, /^(i?tem|product|description|particulars)\b/i, { accept: v => /[A-Za-z]{3}/.test(v) });
      const seller = (() => { for (const l of o.lines.slice(0, 4)) { const t = clean(l.items && l.items[0] ? l.items[0].text : l.text); if (/[A-Za-z]{3}/.test(t) && !/(tax\s*invoice|invoice|bill|receipt|gstin|original)/i.test(t)) return t.replace(/\s*[-–]\s*.*$/, '').replace(/\s*(pvt\.?|private)?\s*(ltd\.?|limited)\s*$/i, ''); } return null; })();
      const brand = textAfter(o, /^brand\b/i, { accept: v => v.length >= 2 && v.length < 25 }) || brandIn((item || '') + '\n' + T);
      const product = item ? clean(item.replace(new RegExp('^' + (brand || '@@').replace(/ /g, '\\s*') + '(?=\\s|\\d)\\s*', 'i'), '')) : null;
      return { product, brand, model: idAfter(o, /mode[ltI1i]\s*(no|number|name)?/i, 3), serial: idAfter(o, /(serial\s*(no|number)?|s\/n|sr\.?\s*no|imei)/i, 5), seller, invoice: idAfter(o, /(invoice|bill|receipt)\s*(no|number|#)/i, 4), price: amountAfter(o, /(grand\s*total|net\s*amount|total\s*amount|invoice\s*value|amount\s*payable|total)/i), purchase, months: w.months ? String(w.months) : null, expiry, extended: w.extended, service: phoneAfter(o, /(customer\s*care|service|helpline|toll\s*free|call)/i), _title: product ? (brand ? `${brand} ${product}` : product) : null, _custom: custom };
    },
    bank(o, T) { return { bank: bankName(T), kind: (m => m ? titleCase(m[1]) : null)(/\b(savings|current|salary|nre|nro)\b/i.exec(T)), number: idAfter(o, /(a\/?c|account)\s*(no|number|#)/i, 8), ifsc: ifsc(T), branch: textAfter(o, /branch/i, { accept: v => v.length > 2 && !/code/i.test(v) }), holder: textAfter(o, /(account\s*holder|name)/i, { accept: isNameLike }), nominee: textAfter(o, /nominee/i, { accept: isNameLike }), custid: idAfter(o, /(customer\s*id|cust\s*id|cif|crn)/i, 5) }; },
    fd(o, T) { const r = textAfter(o, /(rate|roi|interest\s*rate)/i, { accept: v => /\d+(\.\d+)?\s*%?/.test(v) }); return { bank: bankName(T), number: idAfter(o, /(fd|deposit|receipt|account)\s*(no|number)/i, 5), amount: amountAfter(o, /(principal|deposit\s*amount|amount\s*deposited|amount)/i), rate: r ? (/(\d+(?:\.\d+)?)/.exec(r) || [])[1] : null, start: dateAfter(o, /(date\s*of\s*deposit|deposit\s*date|start|value\s*date|opened)/i), expiry: dateAfter(o, /maturity\s*date|due\s*date/i), nominee: textAfter(o, /nominee/i, { accept: isNameLike }) }; },
    invest(o, T) { return { provider: (/\b(zerodha|groww|upstox|angel\s*one|icici\s*direct|hdfc\s*securities|kotak\s*securities|cams|kfintech|nsdl|cdsl|sbi\s*mutual\s*fund|hdfc\s*mutual\s*fund)\b/i.exec(T) || [])[1] || null, number: idAfter(o, /(folio|client\s*id|dp\s*id|bo\s*id|account\s*(no|number)|pran)/i, 5), holder: textAfter(o, /(holder|investor|name)/i, { accept: isNameLike }), nominee: textAfter(o, /nominee/i, { accept: isNameLike }) }; },
    medical(o, T) {
      const kind = /discharge/i.test(T) ? 'Discharge summary' : /(prescription|\bRx\b)/i.test(T) ? 'Prescription' : /(report|laboratory|lab\b|test|pathology|radiology|scan)/i.test(T) ? 'Lab report' : /(invoice|bill)/i.test(T) ? 'Bill' : null;
      const doc = (() => { for (const l of o.lines) { const t = clean(l.text); const m = /(Dr\.?\s*[A-Z][A-Za-z .]{2,40}|[A-Z][A-Za-z .&]{2,50}(hospital|clinic|diagnostics|labs?|nursing home|healthcare))/i.exec(t); if (m) return clean(m[0]); } return null; })();
      return { patient: textAfter(o, /(patient\s*name|patient|name)/i, { accept: isNameLike }), kind, doctor: doc, date: dateAfter(o, /(date|dated|collected|reported)/i) || firstDate(T) };
    },
    certificate(o, T) { const m = /certify\s*that\s*(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|kumari)?\s*([A-Z][A-Za-z .]{2,50}?)(?:\s+(?:has|s\/o|d\/o|son|daughter|of)\b)/i.exec(T.replace(/\n/g, ' ')); return { issuer: clean(o.lines[0] ? o.lines[0].text : ''), holder: m ? clean(m[1]) : textAfter(o, /(name|awarded\s*to)/i, { accept: isNameLike }), year: (/\b(19|20)\d{2}\b/.exec(T) || [])[0] || null, number: idAfter(o, /(certificate|roll|seat|enrol?ment|registration)\s*(no|number)/i, 4) }; },
    property(o, T) { return { property: textAfter(o, /(property|flat|unit|survey\s*no|address)/i, { accept: v => v.length > 4 }), kind: (m => m ? titleCase(m[0]) : null)(/(sale\s*deed|agreement\s*for\s*sale|leave\s*and\s*licen[cs]e|rent\s*agreement|property\s*tax|index\s*ii|allotment\s*letter|possession\s*letter)/i.exec(T)), number: idAfter(o, /(document|registration|reg\.?|serial|receipt)\s*(no|number)/i, 3), date: dateAfter(o, /(date|dated|executed)/i) || firstDate(T) }; },
    utility(o, T) { return { provider: (/\b(MSEDCL|Mahavitaran|Tata\s*Power|Adani\s*Electricity|BEST|BESCOM|TNEB|TANGEDCO|CESC|Torrent\s*Power|BSES|Mahanagar\s*Gas|MGL|Indraprastha\s*Gas|IGL|Airtel|Jio|Vodafone\s*Idea|Vi|ACT\s*Fibernet|Hathway|BSNL|Tata\s*Play)\b/i.exec(T) || [])[1] || null, number: idAfter(o, /(consumer|ca|bp|account|customer|service|relationship)\s*(no|number|id)/i, 5), mobile: phoneAfter(o, /(mobile|registered|contact)/i), expiry: dateAfter(o, /(due\s*date|valid\s*till|expiry|renewal|plan\s*end)/i) }; },
    note(o, T) { return { ref: idAfter(o, /(ref(erence)?|no\.?|number|id)\b/i, 4), issuer: clean(o.lines[0] ? o.lines[0].text : '') || null, date: dateAfter(o, /(date|dated|issued)/i) || firstDate(T), expiry: dateAfter(o, /(valid\s*till|valid\s*upto|expiry|expires|renewal)/i) }; },
  };
  X.debit = X.credit;

  function extract(type, ocr) {
    // fold full-width punctuation (：，／) and odd spacing that OCR models sometimes emit
    ocr = { lines: ocr.lines.map(l => ({ ...l, text: l.text.normalize('NFKC'), items: (l.items || []).map(i => ({ ...i, text: i.text.normalize('NFKC') })) })) };
    const T = allText(ocr);
    const fn = X[type] || X.note;
    const raw = fn(ocr, T) || {};
    const fields = {}; let title = null;
    let custom = [];
    for (const [k, v] of Object.entries(raw)) {
      if (k === '_title') { title = v; continue; }
      if (k === '_custom') { custom = v || []; continue; }
      if (v == null || v === '') continue;
      const o = typeof v === 'object' ? v : { value: v, conf: 'medium' };
      if (o.value == null || o.value === '') continue;
      o.value = String(o.value).trim();
      if (['name', 'father', 'owner', 'holder', 'nominee', 'patient'].includes(k) && o.conf !== 'high') o.value = nameOut(o.value);
      fields[k] = o;
    }
    return { fields, title, custom, text: T };
  }

  window.TijoriExtract = { extract, _t: { dates, verhoeff, luhn, panNumber, aadhaarNumber, cardNumber, mrz, ifsc, dlNumber, vehicleReg, amount, phone } };
})();
