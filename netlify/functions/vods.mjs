import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/vods" };
// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const hits = new Map();
const limited = (req, key, max, ms) => { const ip = String((req.headers.get("cf-connecting-ip") || req.headers.get("x-nf-client-connection-ip")) || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };


// VOD list + thumbnails + emoji reactions. Only the owner key can add/edit/delete. Anyone can react.
const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const PALETTE = ["🔥", "😂", "😮", "👏", "❤️", "👀", "💀", "🎉"];
const EMOJI_RE = /^\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*️?$/u;
const MAX_VODS = 100, MAX_THUMB = 160000, MAX_KINDS = 14, MAX_PER_VOTER = 8;
const clean = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);
const okUrl = u => /^https?:\/\/[^\s]+$/i.test(u) && u.length < 600;

export default async (req) => {
  const s = st(); const url = new URL(req.url);
  const owner = isOwnerReq(req);

  if (req.method === "GET") {
    const th = url.searchParams.get("thumb");
    if (th) {
      if (!/^[a-z0-9]{6,24}$/.test(th)) return new Response("", { status: 404 });
      const d = await s.get("vthumb/" + th, { type: "json" });
      const m = d && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(d);
      if (!m) return new Response("", { status: 404 });
      return new Response(Buffer.from(m[2], "base64"), { headers: { "content-type": "image/" + m[1], "cache-control": "public, max-age=604800, immutable" } });
    }
    const vid = clean(url.searchParams.get("vid"), 40);
    const list = ((await s.get("vods", { type: "json" })) || []).filter(v => v.pub || owner).sort((a, b) => (b.created || 0) - (a.created || 0));
    const out = [];
    for (const v of list) {
      const r = (await s.get("vreact/" + v.id, { type: "json" })) || {};
      const react = Object.entries(r).map(([e, voters]) => ({ e, n: Object.keys(voters).length, me: !!(vid && voters[vid]) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
      out.push({ id: v.id, title: v.title, url: v.url || "", thumb: v.thumb || 0, pub: !!v.pub, created: v.created, started: v.started || null, ended: v.ended || null, react });
    }
    return J({ vods: out, owner, palette: PALETTE });
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text(); if (raw.length > (owner ? 400000 : 4000)) return J({ error: "Too big." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400);

  if (b.op === "react") {
    const id = clean(b.id, 24), vid = clean(b.vid, 40), e = String(b.emoji || "").trim();
    if (!/^[A-Za-z0-9]{8,40}$/.test(vid)) return J({ error: "vid" }, 400);
    if (limited(req, "react", 40, 600000)) return J({ error: "Slow down a little." }, 429);
    if (!(PALETTE.includes(e) || (e.length <= 16 && EMOJI_RE.test(e)))) return J({ error: "Pick a single emoji." }, 400);
    const list = (await s.get("vods", { type: "json" })) || [];
    if (!list.some(v => v.id === id && v.pub)) return J({ error: "not found" }, 404);
    const r = (await s.get("vreact/" + id, { type: "json" })) || {};
    r[e] = r[e] || {};
    if (r[e][vid]) { delete r[e][vid]; if (!Object.keys(r[e]).length) delete r[e]; }
    else {
      if (Object.keys(r).length >= MAX_KINDS && !r[e]) return J({ error: "That video has the maximum number of different emojis." }, 400);
      const mine = Object.values(r).filter(v => v[vid]).length; if (mine >= MAX_PER_VOTER) return J({ error: "Remove one of your reactions first." }, 400);
      r[e] = r[e] || {}; r[e][vid] = 1;
    }
    await s.setJSON("vreact/" + id, r); return J({ ok: true });
  }

  if (!owner) return J({ error: "owner only" }, 403);
  const list = (await s.get("vods", { type: "json" })) || [];

  if (b.op === "add" || b.op === "update") {
    const title = clean(b.title, 100), link = String(b.url || "").trim();
    if (!title) return J({ error: "Add a title." }, 400);
    if (!okUrl(link)) return J({ error: "Paste the full VOD link starting with https://" }, 400);
    let v;
    if (b.op === "add") { if (list.length >= MAX_VODS) return J({ error: "Too many VODs. Delete an old one first." }, 400); v = { id: Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), created: Date.now() }; list.push(v); }
    else { v = list.find(x => x.id === clean(b.id, 24)); if (!v) return J({ error: "not found" }, 404); }
    v.title = title; v.url = link; v.pub = true;
    if (b.thumb) {
      const t = String(b.thumb);
      if (t.length > MAX_THUMB || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(t)) return J({ error: "Thumbnail is too big or not an image." }, 400);
      await s.setJSON("vthumb/" + v.id, t); v.thumb = Date.now();
    }
    await s.setJSON("vods", list); return J({ ok: true, id: v.id });
  }
  if (b.op === "delete") {
    const id = clean(b.id, 24); await s.setJSON("vods", list.filter(v => v.id !== id));
    try { await s.delete("vthumb/" + id); await s.delete("vreact/" + id); } catch {}
    return J({ ok: true });
  }
  return J({ error: "op" }, 400);
};
