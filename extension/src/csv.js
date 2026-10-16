// CSV: декодирование (UTF-8 / Windows-1251), автоопределение разделителя, парсер RFC 4180, сериализация.
(() => {
  const TT = (window.TTCSV = window.TTCSV || {});

  function decode(buf, enc = 'auto') {
    const strip = (s) => s.replace(/^\uFEFF/, '');
    if (enc && enc !== 'auto') return { text: strip(new TextDecoder(enc).decode(buf)), encoding: enc };
    try {
      return { text: strip(new TextDecoder('utf-8', { fatal: true }).decode(buf)), encoding: 'utf-8' };
    } catch (_) {
      return { text: strip(new TextDecoder('windows-1251').decode(buf)), encoding: 'windows-1251' };
    }
  }

  function firstLine(text) {
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ && (c === '\n' || c === '\r')) return text.slice(0, i);
    }
    return text;
  }

  function detectDelimiter(text) {
    const line = firstLine(text).replace(/"[^"]*"/g, '');
    const cands = [';', ',', '\t', '|'];
    let best = ',', max = -1;
    for (const d of cands) {
      const n = line.split(d).length - 1;
      if (n > max) { max = n; best = d; }
    }
    return best;
  }

  function parse(text, delim) {
    const rows = [];
    let row = [], field = '', inQ = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"' && field === '') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // убрать полностью пустые строки
    return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
  }

  function stringify(rows, delim = ';') {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /["\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map((r) => r.map(esc).join(delim)).join('\r\n');
  }

  TT.csv = { decode, detectDelimiter, parse, stringify };
})();
