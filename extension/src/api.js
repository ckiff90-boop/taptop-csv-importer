// Обёртка над внутренним API редактора Taptop (/-/x-api/v1/protected/?method=mosaic/...).
// Авторизация — cookie текущей сессии редактора (same-origin), параметры ver_id/access — из URL редактора.
(() => {
  const TT = (window.TTCSV = window.TTCSV || {});
  const BASE = '/-/x-api/v1/protected/?';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const url = new URL(location.href);
  const VER_ID = url.searchParams.get('ver_id');
  const ACCESS = url.searchParams.get('access');

  // типы полей Taptop -> ключ значения в item_data / в ответе item/get
  const VALUE_KEY = {
    title: 'title', slug: 'url', text: 'text', image: 'image', date: 'dateTime', link: 'link',
    rich_text: 'richText', number: 'number', switcher: 'value',
    reference: 'references', multi_reference: 'references',
  };
  const TYPE_LABEL = {
    title: 'Заголовок', slug: 'Slug', text: 'Текст', image: 'Изображение', date: 'Дата', link: 'Ссылка',
    rich_text: 'Rich text', number: 'Число', switcher: 'Переключатель',
    reference: 'Связь', multi_reference: 'Множ. связь',
  };

  function buildUrl(method, params = {}) {
    let q = `method=mosaic/${method}&ver_id=${encodeURIComponent(VER_ID)}&access=${encodeURIComponent(ACCESS)}`;
    for (const [k, v] of Object.entries(params)) {
      if (v && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) if (sv != null) q += `&param[${k}][${sk}]=${encodeURIComponent(sv)}`;
      } else q += `&param[${k}]=${encodeURIComponent(v)}`;
    }
    return BASE + q + '&request_id=false';
  }

  async function call(method, params = {}, body = null) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      let res;
      try {
        res = await fetch(buildUrl(method, params), {
          method: body ? 'POST' : 'GET',
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          credentials: 'include',
          body: body || undefined,
        });
      } catch (e) {
        lastErr = new Error('Сеть: ' + (e?.message || e));
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new Error(`Нет доступа (HTTP ${res.status}) — обновите страницу редактора / перезайдите`);
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`HTTP ${res.status}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      let js;
      try { js = await res.json(); } catch (_) { throw new Error(`HTTP ${res.status}: ответ не JSON`); }
      const err = js?.error || (js?.result?.status === 'error' ? js.result : null);
      if (err) {
        const code = String(err.code ?? '');
        if (code === '12' && attempt < 3) { lastErr = new Error('Сервер просит повторить позже'); await sleep(2000 * (attempt + 1)); continue; }
        const msg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
        throw new Error(code ? `${msg} (код ${code})` : msg);
      }
      return js.result;
    }
    throw lastErr || new Error('Не удалось выполнить запрос');
  }

  function formBody(itemData, files) {
    const fd = new FormData();
    fd.append('item_data', JSON.stringify(itemData || {}));
    for (const [name, file] of Object.entries(files || {})) fd.append(name, file, file.name);
    return fd;
  }

  // Поля коллекции в порядке cOrder; без reverse_references и удалённых.
  function fieldsOf(col) {
    const all = [...(col.settings || []), ...(col.cSchema || [])].filter(
      (f) => !f.deleted && VALUE_KEY[f.type]
    );
    const byId = Object.fromEntries(all.map((f) => [f.id, f]));
    const ordered = (col.cOrder || []).map((id) => byId[id]).filter(Boolean);
    for (const f of all) if (!ordered.includes(f)) ordered.push(f);
    return ordered;
  }

  async function getAllItems(collectionId, onProgress) {
    const perPage = 100;
    let page = 1, items = [], total = null, col = null;
    for (;;) {
      const r = await call('collection/get', {
        collection_id: collectionId, filters: '[]', sort: '[]', page, per_page: perPage, fields: '[]',
      });
      col = col || r;
      const got = r?.page?.items || [];
      total = r?.page?.allItemsCount ?? r?.allItemsCount ?? total;
      items = items.concat(got);
      onProgress?.(items.length, total);
      if (!got.length || got.length < perPage || (total != null && items.length >= total)) break;
      page++;
      if (page > 100) break;
    }
    return { collection: col, items };
  }

  // значение поля из объекта элемента
  function itemValue(item, fieldId) {
    return (item.fields || []).find((f) => f.fieldId === fieldId) || null;
  }

  TT.api = {
    VER_ID, ACCESS, VALUE_KEY, TYPE_LABEL, sleep, fieldsOf, itemValue, getAllItems,
    ok: () => Boolean(VER_ID && ACCESS),
    listCollections: () => call('collection/list', { add_item_count: true }),
    getCollection: (id) => call('collection/get', { collection_id: id, filters: '[]', sort: '[]', page: 1, per_page: 1, fields: '[]' }),
    createItem: (collectionId, itemData, files) => call('collection/item/create', { collection_id: collectionId }, formBody(itemData, files)),
    updateItem: (itemId, itemData, files) => call('collection/item/update', { item_id: itemId }, formBody(itemData, files)),
    getItem: (itemId) => call('collection/item/get', { item_id: itemId }),
    // создать поле коллекции; ответ пустой — id нового поля ищется сравнением схем до/после
    addField: (collectionId, type, fieldName, referencedCollectionId) =>
      call('collection/addNewField', {
        collection_id: collectionId, field_type: type,
        field_data: { fieldName, referencedCollectionId: referencedCollectionId ?? null },
      }),
    NEW_FIELD_TYPES: ['text', 'rich_text', 'number', 'date', 'link', 'image', 'switcher', 'reference', 'multi_reference'],
  };
})();
