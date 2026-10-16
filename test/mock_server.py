#!/usr/bin/env python3
"""Мок внутреннего API редактора Taptop для локальной проверки расширения.
Формы запросов/ответов взяты из реального HAR редактора (collection/list, get, item/create, item/update).
Запуск: python3 test/mock_server.py 8765  → http://127.0.0.1:8765/-/cms/v1/mosaic/?ver_id=1&access=u%3B1
"""
import json, sys, re, os, itertools
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qsl
from email.parser import BytesParser
from email.policy import default as email_default

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, 'extension')
ids = itertools.count(9000)
img_ids = itertools.count(5000)

TITLE = {"id": "title", "fieldName": "Title", "type": "title", "max": 200}
SLUG = {"id": "slug", "fieldName": "Slug", "type": "slug", "basedOnFieldId": "title"}

def F(id, type, name, **kw):
    return {"id": id, "type": type, "fieldName": name, "deleted": None, "isRequired": False, **kw}

COLS = {
    100: {"id": 100, "title": "Услуги", "settings": [TITLE, SLUG], "cSchema": [], "indexedUrl": "uslugi", "items": []},
    200: {"id": 200, "title": "Породы", "settings": [TITLE, SLUG], "indexedUrl": "porody", "items": [], "cSchema": [
        F("f7da6f", "multi_reference", "Перечень услуг", referencedCollectionId=100),
        F("724fd5", "reference", "Основная услуга", referencedCollectionId=100),
        F("68ebf9", "image", "Фото породы"),
        F("d9783a", "number", "Стоимость"),
        F("6dd42d", "text", "Комментарий"),
        F("aa11bb", "rich_text", "Описание"),
        F("cc22dd", "date", "Дата"),
        F("ee33ff", "link", "Сайт"),
        F("ab12cd", "switcher", "Популярная"),
        F("dead00", "text", "Удалённое", deleted=True),
    ]},
}
for c in COLS.values():
    c["cOrder"] = ["title", "slug"] + [f["id"] for f in c["cSchema"]]

def translit(s):
    t = dict(zip("абвгдеёжзийклмнопрстуфхцчшщъыьэюя", ["a","b","v","g","d","e","e","zh","z","i","j","k","l","m","n","o","p","r","s","t","u","f","h","c","ch","sh","shch","","y","","e","yu","ya"]))
    out = "".join(t.get(ch, ch) for ch in s.lower())
    return re.sub(r"[^a-z0-9]+", "-", out).strip("-") or "item"

def make_item(col, data):
    return {"id": next(ids), "fields": []}

def field_obj(f, store):
    key = {"title": "title", "slug": "url", "text": "text", "image": "image", "date": "dateTime", "link": "link",
           "rich_text": "richText", "number": "number", "switcher": "value", "reference": "references", "multi_reference": "references"}[f["type"]]
    v = store.get(f["id"], {})
    o = {"fieldId": f["id"]}
    if f["type"] in ("reference", "multi_reference"):
        o["references"] = [{"id": i, "title": title_of(f["referencedCollectionId"], i)} for i in v.get("references", [])]
    else:
        o[key] = v.get(key)
    return o

def title_of(cid, iid):
    for it in COLS[cid]["items"]:
        if it["id"] == iid:
            return it["data"]["title"]["title"]
    return None

def render_item(col, it):
    fields = [col["settings"][0], col["settings"][1]] + [f for f in col["cSchema"] if not f.get("deleted")]
    return {"id": it["id"], "fields": [field_obj(f, it["data"]) for f in fields]}

def col_public(col, page=None):
    d = {k: v for k, v in col.items() if k != "items"}
    d["allItemsCount"] = len(col["items"])
    if page is not None:
        num, per = page
        sl = col["items"][(num - 1) * per: num * per]
        d["page"] = {"number": num, "items": [render_item(col, i) for i in sl], "perPage": per, "allItemsCount": len(col["items"])}
    return d

LOG = []

def apply(col, it, item_data, files):
    for fid, v in item_data.items():
        f = next((x for x in col["settings"] + col["cSchema"] if x["id"] == fid), None)
        if not f:
            raise ValueError(f"unknown field {fid}")
        it["data"][fid] = v
    for name, (fn, size) in files.items():
        fid = name.split("_", 1)[1]
        it["data"][fid] = {"image": {"id": str(next(img_ids)), "src": f"/d/{translit(fn.rsplit('.',1)[0])}.{fn.rsplit('.',1)[-1]}", "size": size}}
    if "title" in it["data"] and "slug" not in it["data"]:
        base = translit(it["data"]["title"]["title"]); s = base; n = 1
        while any(x is not it and x["data"].get("slug", {}).get("url") == s for x in col["items"]):
            s = f"{base}-{n}"; n += 1
        it["data"]["slug"] = {"url": s, "basedOnText": None}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, code, body, ctype="application/json"):
        b = body if isinstance(body, bytes) else body.encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self): self.route()
    def do_POST(self): self.route()

    def route(self):
        u = urlparse(self.path)
        if u.path == "/-/cms/v1/mosaic/":
            scripts = "".join(f'<script src="/ext/src/{n}"></script>' for n in ("csv.js", "api.js", "convert.js", "ui.js"))
            return self.send(200, f"<!doctype html><meta charset=utf-8><title>mock editor</title><body style='background:#ddd'><h1>Mock Taptop editor</h1>{scripts}</body>", "text/html; charset=utf-8")
        if u.path.startswith("/ext/"):
            p = os.path.join(EXT, u.path[5:])
            return self.send(200, open(p, "rb").read(), "text/javascript; charset=utf-8")
        if u.path == "/img/dog.jpg":
            return self.send(200, b"\xff\xd8\xff\xe0" + b"0" * 2000, "image/jpeg")
        if u.path == "/state":
            return self.send(200, json.dumps({str(k): col_public(v, (1, 1000)) for k, v in COLS.items()} | {"log": LOG}, ensure_ascii=False))
        if u.path == "/-/x-api/v1/protected/":
            return self.api(u)
        self.send(404, "not found", "text/plain")

    def api(self, u):
        q = dict(parse_qsl(u.query, keep_blank_values=True))
        p = {k[6:-1]: v for k, v in q.items() if k.startswith("param[")}
        m = q.get("method", "")
        if q.get("ver_id") != "1" or q.get("access") != "u;1" or self.headers.get("X-Requested-With") != "XMLHttpRequest":
            return self.send(200, json.dumps({"error": {"code": "1", "message": "bad access"}}))
        item_data, files = {}, {}
        if self.command == "POST":
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            ct = self.headers.get("Content-Type", "")
            if ct.startswith("multipart/form-data"):
                msg = BytesParser(policy=email_default).parsebytes(b"Content-Type: " + ct.encode() + b"\r\n\r\n" + body)
                for part in msg.iter_parts():
                    name = part.get_param("name", header="content-disposition")
                    if name == "item_data":
                        item_data = json.loads(part.get_payload(decode=True).decode("utf-8"))
                    else:
                        files[name] = (part.get_filename(), len(part.get_payload(decode=True)))
        LOG.append({"method": m, "params": p, "item_data": item_data, "files": files})
        try:
            if m == "mosaic/collection/list":
                r = [col_public(c) for c in COLS.values()]
            elif m == "mosaic/collection/get":
                c = COLS[int(p["collection_id"])]
                r = col_public(c, (int(p.get("page", 1)), int(p.get("per_page", 100))))
            elif m == "mosaic/collection/addNewField":
                c = COLS[int(p["collection_id"])]
                fid = os.urandom(3).hex()
                extra = {}
                if p.get("field_data][referencedCollectionId"):
                    extra["referencedCollectionId"] = int(p["field_data][referencedCollectionId"])
                c["cSchema"].append(F(fid, p["field_type"], p["field_data][fieldName"], **extra))
                c["cOrder"].append(fid)
                r = []
            elif m == "mosaic/collection/item/create":
                c = COLS[int(p["collection_id"])]
                if "title" not in item_data: raise ValueError("title required")
                it = {"id": next(ids), "data": {}}
                apply(c, it, item_data, files); c["items"].append(it)
                r = render_item(c, it)
            elif m == "mosaic/collection/item/update":
                iid = int(p["item_id"])
                c, it = next((c, it) for c in COLS.values() for it in c["items"] if it["id"] == iid)
                apply(c, it, item_data, files)
                r = []
            else:
                raise ValueError("unknown method " + m)
            self.send(200, json.dumps({"result": r}, ensure_ascii=False))
        except Exception as e:
            self.send(200, json.dumps({"error": {"code": "0", "message": str(e)}}, ensure_ascii=False))

if __name__ == "__main__":
    # стартовые элементы: услуги + одна порода (для проверки upsert)
    for t in ("Стрижка", "Мытьё", "Когти"):
        it = {"id": next(ids), "data": {}}; apply(COLS[100], it, {"title": {"title": t}}, {}); COLS[100]["items"].append(it)
    it = {"id": next(ids), "data": {}}; apply(COLS[200], it, {"title": {"title": "Овчарка"}}, {}); COLS[200]["items"].append(it)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
