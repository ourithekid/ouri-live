import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: ["/api/cemotes", "/api/cemote/*"] };
// Custom chat emotes that only the owner can upload. Everybody can see and use them in the site chat.
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const st = () => getStore({ name: "ouri-emotes", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const NAME = /^[A-Za-z0-9_]{2,25}$/, TYPES = { "image/png": 1, "image/gif": 1, "image/webp": 1, "image/jpeg": 1 };
export default async (req) => {
  const s = st(), url = new URL(req.url);
  if (req.method === "GET") {
    const m = url.pathname.match(/^\/api\/cemote\/([A-Za-z0-9_]{2,25})$/);
    if (m) {
      const e = await s.get("img/" + m[1], { type: "json" }); if (!e) return new Response("not found", { status: 404 });
      return new Response(Buffer.from(e.d, "base64"), { headers: { "content-type": e.c, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    const idx = (await s.get("index", { type: "json" })) || [];
    return new Response(JSON.stringify({ list: idx }), { headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req) || !isOwnerReq(req)) return J({ error: "owner only" }, 403);
  let b; try { b = JSON.parse(await req.text()); } catch { return J({ error: "Bad request." }, 400); }
  const name = String((b && b.name) || "");
  if (!NAME.test(name)) return J({ error: "Name: 2 to 25 letters, numbers or underscores." }, 400);
  let idx = (await s.get("index", { type: "json" })) || [];
  if (b.op === "del") { await s.delete("img/" + name); idx = idx.filter(e => e.n !== name); await s.setJSON("index", idx); return J({ ok: true, list: idx }); }
  if (b.op === "add") {
    const m = /^data:(image\/(?:png|gif|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.data || "")); if (!m || !TYPES[m[1]]) return J({ error: "Use a PNG, GIF, WebP or JPG image." }, 400);
    if (m[2].length > 280000) return J({ error: "That image is too big (keep it under about 200 KB)." }, 413);
    if (idx.length >= 100 && !idx.some(e => e.n === name)) return J({ error: "Limit is 100 custom emotes." }, 400);
    await s.setJSON("img/" + name, { c: m[1], d: m[2] });
    idx = idx.filter(e => e.n !== name).concat({ n: name, v: Date.now() }); await s.setJSON("index", idx); return J({ ok: true, list: idx });
  }
  return J({ error: "Bad request." }, 400);
};
