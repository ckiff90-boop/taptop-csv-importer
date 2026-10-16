// Панель импорта/экспорта внутри редактора Taptop (Shadow DOM, не конфликтует со стилями редактора).
(() => {
  const TT = (window.TTCSV = window.TTCSV || {});
  if (TT.uiMounted) return;
  TT.uiMounted = true;
  const { api, csv, convert } = TT;

  // ---------- helpers ----------
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  function download(name, text) {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const safeName = (s) => String(s || 'collection').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);

  const ALIASES = {
    title: ['title', 'название', 'заголовок', 'наименование', 'name', 'имя'],
    slug: ['slug', 'слаг', 'url', 'адрес', 'алиас', 'alias'],
  };

  // ---------- state ----------
  const S = {
    collections: [], col: null, fields: [],
    file: null, buf: null, headers: [], rows: [], encoding: '', delim: '',
    mapping: [], images: new Map(), running: false, stop: false, report: [],
  };

  // ---------- DOM ----------
  const host = h('div', { id: 'ttcsv-host' });
  const root = host.attachShadow({ mode: 'open' });
  root.append(h('style', {}, `
    :host{all:initial}
    *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .fab{position:fixed;left:14px;bottom:14px;z-index:2147483646;background:#111827;color:#fff;border:0;border-radius:10px;
      padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:.85}
    .fab:hover{opacity:1}
    .panel{position:fixed;top:56px;right:16px;width:500px;max-height:calc(100vh - 72px);overflow:auto;z-index:2147483647;
      background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.22);font-size:13px;display:none}
    .panel.open{display:block}
    .hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eef0f3;position:sticky;top:0;background:#fff;z-index:2}
    .hd b{font-size:14px}
    .x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#6b7280}
    .sec{padding:12px 16px;border-bottom:1px solid #f1f2f4}
    .sec h4{margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
    select,input[type=text],input[type=number]{border:1px solid #d1d5db;border-radius:8px;padding:6px 8px;font-size:13px;background:#fff;color:#111827}
    select{max-width:100%}
    .grow{flex:1;min-width:0}
    button.b{border:1px solid #d1d5db;background:#f9fafb;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer;color:#111827}
    button.b:hover{background:#f3f4f6}
    button.p{background:#2563eb;border-color:#2563eb;color:#fff}
    button.p:hover{background:#1d4ed8}
    button.d{background:#fff;border-color:#ef4444;color:#b91c1c}
    button:disabled{opacity:.5;cursor:default}
    .muted{color:#6b7280;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    td,th{padding:4px 4px;border-bottom:1px solid #f1f2f4;text-align:left;vertical-align:middle}
    th{color:#6b7280;font-weight:500}
    td.sample{color:#6b7280;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    td select{width:100%}
    .bar{height:6px;background:#eef0f3;border-radius:4px;overflow:hidden;margin:8px 0}
    .bar i{display:block;height:100%;width:0;background:#2563eb;transition:width .2s}
    .log{max-height:220px;overflow:auto;background:#0b1020;color:#d1d5db;border-radius:8px;padding:8px;font:11.5px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
    .log .e{color:#fca5a5}.log .w{color:#fcd34d}.log .o{color:#86efac}
    label.ck{display:flex;gap:6px;align-items:center;font-size:12.5px}
    .warn{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:8px;padding:8px;font-size:12px;margin-top:6px}
  `));

  const fab = h('button', { class: 'fab', title: 'Импорт CSV в коллекции', onclick: () => toggle() }, 'CSV ⇄ Коллекции');
  const panel = h('div', { class: 'panel' });
  root.append(fab, panel);

  // header
  panel.append(h('div', { class: 'hd' }, h('b', {}, 'CSV ⇄ Коллекции Taptop'), h('button', { class: 'x', onclick: () => toggle(false) }, '×')));

  // collection section
  const selCol = h('select', { class: 'grow', onchange: () => selectCollection(selCol.value) });
  const colInfo = h('div', { class: 'muted' });
  panel.append(h('div', { class: 'sec' },
    h('h4', {}, '1. Коллекция'),
    h('div', { class: 'row' }, selCol, h('button', { class: 'b', title: 'Обновить список', onclick: () => loadCollections() }, '↻')),
    colInfo,
    h('div', { class: 'row' },
      h('button', { class: 'b', onclick: () => downloadTemplate() }, 'Шаблон CSV'),
      h('button', { class: 'b', onclick: () => exportCollection() }, 'Экспорт коллекции в CSV')),
  ));

  // file section
  const inFile = h('input', { type: 'file', accept: '.csv,text/csv,.txt', onchange: () => loadFile(inFile.files[0]) });
  const selEnc = h('select', { onchange: () => S.buf && parseBuf() },
    h('option', { value: 'auto' }, 'Кодировка: авто'), h('option', { value: 'utf-8' }, 'UTF-8'), h('option', { value: 'windows-1251' }, 'Windows-1251'));
  const selDelim = h('select', { onchange: () => S.buf && parseBuf() },
    h('option', { value: 'auto' }, 'Разделитель: авто'), h('option', { value: ';' }, ';'), h('option', { value: ',' }, ','), h('option', { value: '\t' }, 'Tab'));
  const fileInfo = h('div', { class: 'muted' });
  const inImages = h('input', { type: 'file', accept: 'image/*', multiple: true, onchange: () => loadImages(inImages.files) });
  const imgInfo = h('div', { class: 'muted' }, 'Необязательно. Если в CSV в поле-картинке указано имя файла (photo1.jpg) — выберите эти файлы здесь. Ссылки http(s) скачиваются автоматически.');
  panel.append(h('div', { class: 'sec' },
    h('h4', {}, '2. Файл CSV'),
    h('div', { class: 'row' }, inFile),
    h('div', { class: 'row' }, selEnc, selDelim),
    fileInfo,
    h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: 'muted' }, 'Картинки:'), inImages),
    imgInfo,
  ));

  // mapping
  const mapBox = h('div', {}, h('div', { class: 'muted' }, 'Выберите коллекцию и CSV-файл.'));
  panel.append(h('div', { class: 'sec' }, h('h4', {}, '3. Сопоставление колонок'), mapBox));

  // options
  const selMode = h('select', { class: 'grow' },
    h('option', { value: 'upsert' }, 'Создать новые + обновить существующие'),
    h('option', { value: 'create' }, 'Только создать (все строки — новые элементы)'),
    h('option', { value: 'update' }, 'Только обновить существующие'));
  const selKey = h('select', {}, h('option', { value: 'slug' }, 'ключ: Slug'), h('option', { value: 'title' }, 'ключ: Заголовок'));
  const inSep = h('input', { type: 'text', value: '|', style: 'width:44px' });
  const inDelay = h('input', { type: 'number', value: '300', min: '0', step: '50', style: 'width:80px' });
  const ckClear = h('input', { type: 'checkbox' });
  panel.append(h('div', { class: 'sec' },
    h('h4', {}, '4. Параметры'),
    h('div', { class: 'row' }, selMode, selKey),
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Разделитель для множ. связей'), inSep,
      h('span', { class: 'muted' }, 'Пауза, мс'), inDelay),
    h('label', { class: 'ck' }, ckClear, 'Пустые ячейки очищают поле (иначе — не трогать)'),
  ));

  // run
  const btnCheck = h('button', { class: 'b', onclick: () => run(true) }, 'Проверить без записи');
  const btnRun = h('button', { class: 'b p', onclick: () => run(false) }, 'Импортировать');
  const btnStop = h('button', { class: 'b d', disabled: true, onclick: () => { S.stop = true; log('Остановка после текущей строки…', 'w'); } }, 'Стоп');
  const btnReport = h('button', { class: 'b', disabled: true, onclick: () => downloadReport() }, 'Отчёт об ошибках');
  const bar = h('i');
  const status = h('div', { class: 'muted' });
  const logBox = h('div', { class: 'log' });
  panel.append(h('div', { class: 'sec' },
    h('h4', {}, '5. Запуск'),
    h('div', { class: 'row' }, btnCheck, btnRun, btnStop, btnReport),
    h('div', { class: 'bar' }, bar), status, logBox,
  ));
  panel.append(h('div', { class: 'sec muted' }, 'После импорта обновите страницу редактора (F5), чтобы увидеть новые элементы в панели коллекций.'));

  function log(msg, cls = '') {
    const line = h('div', { class: cls }, msg);
    logBox.append(line);
    logBox.scrollTop = logBox.scrollHeight;
  }
  function setProgress(done, total, text) {
    bar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    status.textContent = text || '';
  }

  function toggle(force) {
    const open = force ?? !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    if (open && !S.collections.length) loadCollections();
  }

  // ---------- collections ----------
  async function loadCollections() {
    if (!api.ok()) { colInfo.textContent = 'Не найдены ver_id/access в адресе — откройте расширение в редакторе Taptop.'; return; }
    colInfo.textContent = 'Загрузка коллекций…';
    try {
      const list = await api.listCollections();
      S.collections = Array.isArray(list) ? list : [];
      selCol.replaceChildren(h('option', { value: '' }, S.collections.length ? '— выберите коллекцию —' : 'Коллекций нет'),
        ...S.collections.map((c) => h('option', { value: c.id }, `${c.title} (${c.allItemsCount ?? '?'})`)));
      colInfo.textContent = '';
      if (S.col) { selCol.value = S.col.id; selectCollection(S.col.id); }
    } catch (e) {
      colInfo.textContent = 'Ошибка: ' + e.message;
    }
  }

  function selectCollection(id) {
    S.col = S.collections.find((c) => String(c.id) === String(id)) || null;
    S.fields = S.col ? api.fieldsOf(S.col) : [];
    colInfo.textContent = S.col
      ? `Элементов: ${S.col.allItemsCount ?? '?'}. Поля: ${S.fields.map((f) => `${f.fieldName} (${api.TYPE_LABEL[f.type] || f.type})`).join(', ')}`
      : '';
    autoMap(); renderMapping();
  }

  function headerName(f) {
    const dup = S.fields.filter((x) => norm(x.fieldName) === norm(f.fieldName)).length > 1;
    return dup ? `${f.fieldName} [${f.id}]` : f.fieldName;
  }

  function downloadTemplate() {
    if (!S.col) return alert('Сначала выберите коллекцию');
    download(`${safeName(S.col.title)}-шаблон.csv`, csv.stringify([S.fields.map(headerName)], ';'));
  }

  async function exportCollection() {
    if (!S.col) return alert('Сначала выберите коллекцию');
    try {
      log(`Экспорт «${S.col.title}»…`);
      const { items } = await api.getAllItems(S.col.id, (n, t) => setProgress(n, t, `Загружено ${n} из ${t ?? '?'}`));
      const refMaps = await loadRefMaps(S.fields);
      const ctx = { refMaps, multiSep: inSep.value || '|' };
      const rows = [S.fields.map(headerName)];
      for (const it of items) rows.push(S.fields.map((f) => convert.fromItemValue(f, api.itemValue(it, f.id), ctx)));
      download(`${safeName(S.col.title)}.csv`, csv.stringify(rows, ';'));
      log(`Экспортировано элементов: ${items.length}`, 'o');
    } catch (e) {
      log('Ошибка экспорта: ' + e.message, 'e');
    }
  }

  // ---------- file ----------
  async function loadFile(file) {
    if (!file) return;
    S.file = file;
    S.buf = await file.arrayBuffer();
    parseBuf();
  }
  function parseBuf() {
    const dec = csv.decode(S.buf, selEnc.value);
    const delim = selDelim.value === 'auto' ? csv.detectDelimiter(dec.text) : selDelim.value;
    const rows = csv.parse(dec.text, delim);
    S.encoding = dec.encoding; S.delim = delim;
    S.headers = (rows[0] || []).map((x) => String(x).trim());
    S.rows = rows.slice(1);
    const dn = { ';': ';', ',': ',', '\t': 'Tab', '|': '|' }[delim] || delim;
    fileInfo.textContent = `${S.file.name}: строк данных ${S.rows.length}, колонок ${S.headers.length}, кодировка ${S.encoding}, разделитель «${dn}»`;
    autoMap(); renderMapping();
  }
  function loadImages(files) {
    S.images = new Map();
    for (const f of files) S.images.set(f.name.toLowerCase(), f);
    imgInfo.textContent = `Выбрано картинок: ${S.images.size}`;
  }

  // ---------- mapping ----------
  function autoMap() {
    S.mapping = S.headers.map((hd) => {
      const n = norm(hd);
      const br = n.match(/\[([a-z0-9_]+)\]\s*$/);
      if (br) { const f = S.fields.find((x) => x.id === br[1]); if (f) return f.id; }
      let f = S.fields.find((x) => norm(x.fieldName) === n) || S.fields.find((x) => x.id === n);
      if (!f) for (const [id, al] of Object.entries(ALIASES)) if (al.includes(n)) { f = S.fields.find((x) => x.id === id); break; }
      return f ? f.id : '';
    });
    // одно поле — одна колонка
    const used = new Set();
    S.mapping = S.mapping.map((id) => (id && !used.has(id) ? (used.add(id), id) : ''));
  }

  function renderMapping() {
    if (!S.col || !S.headers.length) {
      mapBox.replaceChildren(h('div', { class: 'muted' }, 'Выберите коллекцию и CSV-файл.'));
      return;
    }
    const sample = (j) => S.rows.find((r) => String(r[j] ?? '').trim() !== '')?.[j] ?? '';
    const tbl = h('table', {}, h('tr', {}, h('th', {}, 'Колонка CSV'), h('th', {}, 'Пример'), h('th', {}, 'Поле коллекции')));
    S.headers.forEach((hd, j) => {
      const sel = h('select', { onchange: () => { S.mapping[j] = sel.value; renderWarnings(); } },
        h('option', { value: '' }, '— не импортировать —'),
        ...S.fields.map((f) => h('option', { value: f.id }, `${f.fieldName} · ${api.TYPE_LABEL[f.type] || f.type}`)));
      sel.value = S.mapping[j] || '';
      tbl.append(h('tr', {}, h('td', {}, hd || `(колонка ${j + 1})`), h('td', { class: 'sample', title: sample(j) }, sample(j)), h('td', {}, sel)));
    });
    mapBox.replaceChildren(tbl, warnBox);
    renderWarnings();
  }
  const warnBox = h('div');
  function renderWarnings() {
    const w = [];
    const dupl = S.mapping.filter((x, i) => x && S.mapping.indexOf(x) !== i);
    if (dupl.length) w.push('Одно поле выбрано для нескольких колонок — возьмётся последняя.');
    if (!S.mapping.includes('title')) w.push('Не выбрана колонка для Title — новые элементы создать не получится.');
    const unmapped = S.fields.filter((f) => f.isRequired && !S.mapping.includes(f.id));
    if (unmapped.length) w.push('Обязательные поля без колонки: ' + unmapped.map((f) => f.fieldName).join(', '));
    warnBox.replaceChildren(...(w.length ? [h('div', { class: 'warn' }, w.join(' '))] : []));
  }

  // ---------- references ----------
  async function loadRefMaps(fields) {
    const ids = [...new Set(fields.filter((f) => f.type === 'reference' || f.type === 'multi_reference').map((f) => f.referencedCollectionId))];
    const maps = {};
    for (const id of ids) {
      const { items } = await api.getAllItems(id);
      maps[id] = convert.buildRefMap(items);
    }
    return maps;
  }

  // ---------- images ----------
  function fileFromB64(b64, mime, name) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime || 'application/octet-stream' });
  }
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif' };
  function nameFromUrl(u, mime) {
    let base = 'image';
    try { base = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'image'); } catch (_) {}
    base = base.replace(/[?#].*$/, '') || 'image';
    if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += '.' + (EXT[mime] || 'jpg');
    return base;
  }
  async function fetchImage(u) {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const r = await chrome.runtime.sendMessage({ type: 'ttcsv-fetch-image', url: u });
      if (!r?.ok) throw new Error(`картинка не скачалась (${r?.error || 'нет ответа'}): ${u}`);
      if (r.mime && !r.mime.startsWith('image/')) throw new Error(`по ссылке не картинка (${r.mime}): ${u}`);
      return fileFromB64(r.b64, r.mime, nameFromUrl(r.finalUrl || u, r.mime));
    }
    const res = await fetch(u);
    if (!res.ok) throw new Error(`картинка не скачалась (HTTP ${res.status}): ${u}`);
    const blob = await res.blob();
    return new File([blob], nameFromUrl(u, blob.type), { type: blob.type });
  }
  function makeImageResolver(dry, cache) {
    return async (raw) => {
      let s = raw.trim();
      if (s.startsWith('/')) s = location.origin + s;
      if (/^https?:\/\//i.test(s)) {
        if (dry) return { skip: true };
        if (!cache.has(s)) cache.set(s, fetchImage(s));
        return { file: await cache.get(s) };
      }
      const key = s.split(/[\\/]/).pop().toLowerCase();
      const f = S.images.get(key);
      if (!f) throw new Error(`файл «${s}» не выбран в поле «Картинки»`);
      return { file: f };
    };
  }

  // ---------- run ----------
  function lockUi(on) {
    S.running = on;
    btnRun.disabled = on; btnCheck.disabled = on; btnStop.disabled = !on;
    selCol.disabled = on; inFile.disabled = on;
  }

  async function run(dry) {
    if (S.running) return;
    if (!S.col) return alert('Выберите коллекцию');
    if (!S.rows.length) return alert('Загрузите CSV с данными');
    const mode = selMode.value, keyField = selKey.value;
    const mappedCols = S.mapping.map((fid, j) => ({ j, f: S.fields.find((x) => x.id === fid) })).filter((x) => x.f);
    if (!mappedCols.length) return alert('Не сопоставлено ни одной колонки');
    if (mode !== 'update' && !S.mapping.includes('title')) return alert('Для создания элементов нужна колонка с Title');
    if (mode !== 'create' && !S.mapping.includes(keyField)) return alert(`Для обновления нужна колонка-ключ: ${keyField === 'slug' ? 'Slug' : 'Title'}`);

    lockUi(true); S.stop = false; S.report = []; btnReport.disabled = true;
    logBox.replaceChildren();
    const stats = { created: 0, updated: 0, skipped: 0, errors: 0, warn: 0 };
    try {
      log(dry ? '— Проверка без записи —' : `— Импорт в «${S.col.title}» —`);
      const fresh = await api.getCollection(S.col.id);
      const fields = api.fieldsOf(fresh);
      const total0 = fresh?.page?.allItemsCount ?? fresh?.allItemsCount ?? 0;

      const refFields = fields.filter((f) => (f.type === 'reference' || f.type === 'multi_reference') && S.mapping.includes(f.id));
      if (refFields.length) log(`Загружаю связанные коллекции (${refFields.length})…`);
      const refMaps = await loadRefMaps(refFields);

      const keyMap = new Map();
      if (mode !== 'create') {
        log('Загружаю существующие элементы…');
        const { items } = await api.getAllItems(S.col.id, (n, t) => setProgress(n, t, `Существующие: ${n} из ${t ?? '?'}`));
        for (const it of items) {
          const k = keyField === 'slug' ? api.itemValue(it, 'slug')?.url : api.itemValue(it, 'title')?.title;
          if (k) keyMap.set(norm(k), it.id);
        }
        log(`Существующих элементов: ${items.length}`);
      }
      const ctx = {
        refMaps, multiSep: inSep.value || '|', clearEmpty: ckClear.checked,
        resolveImage: makeImageResolver(dry, new Map()),
      };
      const delay = Math.max(0, Number(inDelay.value) || 0);
      const n = S.rows.length;
      let willCreate = 0;

      for (let i = 0; i < n; i++) {
        if (S.stop) { log('Остановлено пользователем.', 'w'); break; }
        const row = S.rows[i];
        const line = i + 2; // номер строки в файле (1 — заголовок)
        setProgress(i, n, `Строка ${i + 1} из ${n}`);
        const itemData = {}, files = {}, errs = [];
        for (const { j, f } of mappedCols) {
          const fresh = fields.find((x) => x.id === f.id) || f;
          try {
            const r = await convert.toItemValue(fresh, row[j], ctx);
            if (r.skip) continue;
            if (r.file) { files[`image_${f.id}`] = r.file; delete itemData[f.id]; }
            else itemData[f.id] = { ...(itemData[f.id] || {}), ...r.data };
          } catch (e) {
            errs.push(`${f.fieldName}: ${e.message}`);
          }
        }
        const title = itemData.title?.title || row[S.mapping.indexOf('title')] || '';
        const label = `стр. ${line}${title ? ` «${String(title).slice(0, 40)}»` : ''}`;
        if (errs.length) {
          stats.errors++; S.report.push([line, errs.join('; '), ...row]);
          log(`✗ ${label}: ${errs.join('; ')}`, 'e');
          continue;
        }
        let existingId = null, keyVal = null;
        if (mode !== 'create') {
          keyVal = keyField === 'slug' ? itemData.slug?.url : itemData.title?.title;
          if (keyVal) existingId = keyMap.get(norm(keyVal)) ?? null;
        }
        if (mode === 'update' && !existingId) {
          stats.skipped++; log(`– ${label}: не найден по ключу «${keyVal || ''}», пропуск`, 'w');
          continue;
        }
        if (!existingId && !itemData.title) {
          stats.errors++; S.report.push([line, 'нет Title для нового элемента', ...row]);
          log(`✗ ${label}: нет Title для нового элемента`, 'e');
          continue;
        }
        if (dry) {
          if (existingId) stats.updated++; else { stats.created++; willCreate++; }
          if (existingId) log(`✓ ${label}: будет обновлён`, 'o');
          else log(`✓ ${label}: будет создан`, 'o');
          if (keyVal && !existingId && mode === 'upsert') keyMap.set(norm(keyVal), 'pending');
          continue;
        }
        try {
          if (existingId && existingId !== 'pending') {
            await api.updateItem(existingId, itemData, files);
            stats.updated++; log(`↻ ${label}: обновлён (id ${existingId})`, 'o');
          } else {
            if (total0 + stats.created >= 2500) throw new Error('достигнут лимит 2500 элементов в коллекции');
            const res = await api.createItem(S.col.id, itemData, files);
            stats.created++;
            const newKey = keyField === 'slug' ? api.itemValue(res, 'slug')?.url : api.itemValue(res, 'title')?.title;
            if (mode === 'upsert' && newKey) keyMap.set(norm(newKey), res.id);
            log(`+ ${label}: создан (id ${res?.id}${api.itemValue(res, 'slug')?.url ? `, slug ${api.itemValue(res, 'slug').url}` : ''})`, 'o');
          }
        } catch (e) {
          stats.errors++; S.report.push([line, e.message, ...row]);
          log(`✗ ${label}: ${e.message}`, 'e');
        }
        if (delay) await api.sleep(delay);
      }
      setProgress(n, n, '');
      if (dry && total0 + willCreate > 1000)
        log(`Внимание: после импорта в коллекции будет ${total0 + willCreate} элементов. По справке Taptop лимит — 1000 на коллекцию.`, 'w');
      const verb = dry ? 'будет ' : '';
      log(`Итог: ${verb}создано ${stats.created}, ${verb}обновлено ${stats.updated}, пропущено ${stats.skipped}, ошибок ${stats.errors}.`, stats.errors ? 'w' : 'o');
      if (!dry && (stats.created || stats.updated)) log('Обновите страницу редактора (F5), чтобы увидеть изменения.', 'w');
    } catch (e) {
      log('Остановлено из-за ошибки: ' + e.message, 'e');
    } finally {
      lockUi(false);
      btnReport.disabled = !S.report.length;
    }
  }

  function downloadReport() {
    const rows = [['Строка', 'Ошибка', ...S.headers], ...S.report];
    download(`ошибки-импорта-${safeName(S.col?.title)}.csv`, csv.stringify(rows, ';'));
  }

  // ---------- mount ----------
  document.documentElement.append(host);
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'ttcsv-toggle') toggle(); });
  }
  TT.ui = { toggle, state: S, run, root };
})();
