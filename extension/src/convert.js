// Преобразование значений CSV <-> формат полей коллекции Taptop.
(() => {
  const TT = (window.TTCSV = window.TTCSV || {});

  const TRUE_SET = new Set(['1', 'true', 'да', 'yes', 'y', '+', 'on', 'вкл', 'истина', 'д']);
  const FALSE_SET = new Set(['0', 'false', 'нет', 'no', 'n', '-', 'off', 'выкл', 'ложь', '']);

  function parseNumber(s) {
    const t = String(s).replace(/[\s\u00a0]/g, '').replace(',', '.');
    if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) throw new Error(`не число: «${s}»`);
    return String(Number(t));
  }

  function mkDate(y, mo, d, hh = 0, mi = 0, ss = 0, src) {
    const dt = new Date(y, mo - 1, d, hh, mi, ss);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || hh > 23 || mi > 59 || ss > 59)
      throw new Error(`несуществующая дата: «${src}»`);
    return dt.getTime();
  }

  function parseDate(s) {
    s = String(s).trim();
    let m;
    if (/^\d{10}$/.test(s)) return Number(s) * 1000;
    if (/^\d{13}$/.test(s)) return Number(s);
    if ((m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)))
      return mkDate(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), s);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)))
      return mkDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), s);
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
    throw new Error(`не дата: «${s}» (нужно ДД.ММ.ГГГГ [ЧЧ:ММ] или ГГГГ-ММ-ДД)`);
  }

  function fmtDate(ms) {
    if (!ms || Number(ms) < 0) return '';
    const d = new Date(Number(ms));
    const p = (n) => String(n).padStart(2, '0');
    const base = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
    return d.getHours() || d.getMinutes() ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
  }

  const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function toRichText(s) {
    if (/<\/?(p|br|h[1-6]|ul|ol|li|strong|em|b|i|a|span|div|blockquote|figure)\b/i.test(s)) return s;
    return s
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map((par) => `<p>${escHtml(par).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  // Карта ссылок для полей-связей: ключ (id / title / slug в нижнем регистре) -> id элемента
  function buildRefMap(items) {
    const byKey = new Map(), byId = new Map();
    for (const it of items) {
      const title = TT.api.itemValue(it, 'title')?.title ?? '';
      const slug = TT.api.itemValue(it, 'slug')?.url ?? '';
      byId.set(String(it.id), title || slug || String(it.id));
      byKey.set(String(it.id), it.id);
      if (slug) byKey.set(slug.toLowerCase(), it.id);
      if (title && !byKey.has(title.trim().toLowerCase())) byKey.set(title.trim().toLowerCase(), it.id);
    }
    return { byKey, byId };
  }

  /**
   * CSV-значение -> часть item_data.
   * Возвращает { data } | { file } | { skip:true } ; бросает Error при ошибке.
   * ctx: { refMaps, multiSep, clearEmpty, resolveImage(raw, field) -> Promise<{file}|{data}> , dry }
   */
  async function toItemValue(field, raw, ctx) {
    const s = raw == null ? '' : String(raw).trim();
    const key = TT.api.VALUE_KEY[field.type];
    const empty = s === '';

    if (empty) {
      if (field.type === 'title') throw new Error('пустой заголовок (Title обязателен)');
      if (!ctx.clearEmpty || field.type === 'slug') return { skip: true };
      switch (field.type) {
        case 'image': return { data: { image_id: -1 } };
        case 'date': return { data: { dateTime: -1 } };
        case 'switcher': return { data: { value: false } };
        case 'number': return { data: { number: '' } };
        case 'reference': case 'multi_reference': return { data: { references: [] } };
        default: return { data: { [key]: '' } };
      }
    }

    switch (field.type) {
      case 'title':
        if (s.length > (field.max || 200)) throw new Error(`заголовок длиннее ${field.max || 200} символов`);
        return { data: { title: s } };
      case 'slug':
        if (!/^[a-z0-9][a-z0-9_-]*$/i.test(s)) throw new Error(`slug «${s}»: только латиница, цифры, - и _`);
        return { data: { url: s.toLowerCase() } };
      case 'text':
        if (field.max && s.length > field.max) throw new Error(`текст длиннее ${field.max} символов`);
        return { data: { text: String(raw) } };
      case 'rich_text':
        return { data: { richText: toRichText(String(raw)) } };
      case 'number':
        return { data: { number: parseNumber(s) } };
      case 'switcher': {
        const v = s.toLowerCase();
        if (TRUE_SET.has(v)) return { data: { value: true } };
        if (FALSE_SET.has(v)) return { data: { value: false } };
        throw new Error(`переключатель: «${s}» (нужно да/нет, 1/0, true/false)`);
      }
      case 'date':
        return { data: { dateTime: parseDate(s) } };
      case 'link':
        return { data: { link: s } };
      case 'reference':
      case 'multi_reference': {
        const map = ctx.refMaps?.[field.referencedCollectionId];
        if (!map) throw new Error('не загружена связанная коллекция');
        const parts = field.type === 'reference' ? [s] : s.split(ctx.multiSep || '|').map((x) => x.trim()).filter(Boolean);
        const ids = [], missing = [];
        for (const p of parts) {
          const id = map.byKey.get(p.toLowerCase()) ?? map.byKey.get(p);
          if (id == null) missing.push(p); else if (!ids.includes(id)) ids.push(id);
        }
        if (missing.length) throw new Error(`не найдено в связанной коллекции: ${missing.map((m) => `«${m}»`).join(', ')}`);
        return { data: { references: ids } };
      }
      case 'image':
        return ctx.resolveImage(s, field);
      default:
        throw new Error(`тип поля ${field.type} не поддерживается`);
    }
  }

  // элемент -> строка значения для экспорта CSV
  function fromItemValue(field, v, ctx) {
    if (!v) return '';
    switch (field.type) {
      case 'title': return v.title ?? '';
      case 'slug': return v.url ?? '';
      case 'text': return v.text ?? '';
      case 'rich_text': return v.richText ?? '';
      case 'number': return v.number ?? '';
      case 'switcher': return v.value ? '1' : '0';
      case 'date': return fmtDate(v.dateTime);
      case 'link': return typeof v.link === 'string' ? v.link : v.link?.url ?? v.link?.href ?? '';
      case 'image': {
        const src = v.image?.src;
        return src ? (src.startsWith('http') ? src : location.origin + src) : '';
      }
      case 'reference':
      case 'multi_reference': {
        const map = ctx.refMaps?.[field.referencedCollectionId];
        return (v.references || [])
          .map((r) => {
            const id = typeof r === 'object' ? r.id : r;
            return (typeof r === 'object' && r.title) || map?.byId.get(String(id)) || String(id);
          })
          .join(field.type === 'reference' ? '' : ` ${ctx.multiSep || '|'} `);
      }
      default: return '';
    }
  }

  // угадать тип нового поля по значениям колонки
  function guessType(values) {
    const v = values.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 200);
    if (!v.length) return 'text';
    const all = (fn) => v.every((x) => { try { return fn(x); } catch (_) { return false; } });
    const BOOL = new Set(['да', 'нет', 'true', 'false', 'yes', 'no', 'вкл', 'выкл', 'on', 'off']);
    if (all((x) => BOOL.has(x.toLowerCase()))) return 'switcher';
    if (all((x) => parseNumber(x) != null)) return 'number';
    if (all((x) => /^\d{1,2}[./]\d{1,2}[./]\d{4}([ T,]+\d{1,2}:\d{2}(:\d{2})?)?$|^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(x) && parseDate(x)))
      return 'date';
    if (all((x) => /^https?:\/\/\S+$/i.test(x)))
      return all((x) => /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff?)(\?.*)?$/i.test(x)) ? 'image' : 'link';
    if (all((x) => /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(x) && !/\s/.test(x))) return 'image';
    if (v.some((x) => /<\/?(p|br|h[1-6]|ul|ol|li|strong|em|b|i|a)\b/i.test(x) || /\n/.test(x))) return 'rich_text';
    return 'text';
  }

  TT.convert = { toItemValue, fromItemValue, buildRefMap, parseDate, parseNumber, toRichText, fmtDate, guessType };
})();
