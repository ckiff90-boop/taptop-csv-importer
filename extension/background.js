// Service worker: скачивает картинки по URL (без CORS-ограничений страницы)
// и открывает/закрывает панель по клику на иконку расширения.

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'ttcsv-toggle' }).catch(() => {
    // не страница редактора Taptop — контент-скрипта нет
  });
});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ttcsv-fetch-image') return false;
  (async () => {
    try {
      const res = await fetch(msg.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 64 * 1024 * 1024) throw new Error('файл больше 64 МБ');
      sendResponse({ ok: true, b64: toBase64(buf), mime, finalUrl: res.url });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true; // async response
});
