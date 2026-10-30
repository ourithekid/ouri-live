import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/db" };

// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const hits = new Map();
const limited = (req, key, max, ms) => { const ip = String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };

const store = () => getStore("ouri");
const COLS = new Set(["clips", "reactions", "votes", "pins", "pinclips", "chanclips", "board", "chatters", "profile", "stats", "emotes", "polls", "pollvotes"]);   // only these exist; anything else is rejected
const OPEN_ADD = new Set(["clips"]);           // anyone can submit
const BAD_IDS = new Set(["__proto__", "constructor", "prototype"]);
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const split = p => { const i = p.indexOf("/"); return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)]; };
const clean = s => String(s || "").replace(/[<>\u0000-\u001f]/g, "").slice(0, 300);
const goodId = id => /^[A-Za-z0-9_-]{1,60}$/.test(id) && !BAD_IDS.has(id);

export default async (req) => {
  const url = new URL(req.url);
  const owner = isOwnerReq(req);
  const s = store();

  if (req.method === "GET") {
    const col = url.searchParams.get("col");
    const doc = url.searchParams.get("doc");
    if (col) {
      if (!COLS.has(col)) return J({ error: "bad request" }, 400);
      const m = (await s.get(col, { type: "json" })) || {};
      return J({ docs: Object.entries(m).map(([id, d]) => ({ id, ...d })) });
    }
    if (doc) {
      const [c, id] = split(doc);
      if (!COLS.has(c) || !goodId(id)) return J({ error: "bad request" }, 400);
      const m = (await s.get(c, { type: "json" })) || {};
      return J({ data: Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null });
    }
    return J({ error: "bad request" }, 400);
  }

  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text();
  if (raw.length > (owner ? 200000 : 20000)) return J({ error: "too big" }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "json" }, 400); }
  if (!b || typeof b !== "object") return J({ error: "json" }, 400);
  const { op, path, data } = b;
  if (typeof path !== "string") return J({ error: "path" }, 400);
  const [c, rawId] = split(path);
  if (!COLS.has(c)) return J({ error: "path" }, 400);
  if (rawId !== "x" && rawId !== "" && !goodId(rawId)) return J({ error: "path" }, 400);
  const m = (await s.get(c, { type: "json" })) || {};

  if (op === "add") {
    if (!owner && !OPEN_ADD.has(c)) return J({ error: "owner only" }, 403);
    if (!owner && limited(req, "add", 6, 600000)) return J({ error: "Slow down a little." }, 429);
    if (Object.keys(m).length >= 500) return J({ error: "full" }, 400);
    const id = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    let d;
    if (owner) { d = { ...(data || {}) }; for (const k of Object.keys(d)) { if (BAD_IDS.has(k)) delete d[k]; else if (typeof d[k] === "string") d[k] = clean(d[k]); } }
    else { const x = data || {}; d = { streamer: clean(x.streamer).slice(0, 40), title: clean(x.title).slice(0, 90), url: String(x.url || "").trim().slice(0, 300), created: Date.now(), by: clean(x.by).slice(0, 60) }; }   // visitors can only send these 4 fields
    if (c === "clips" && !/^https?:\/\/[^\s]+$/i.test(d.url || "")) return J({ error: "url" }, 400);
    if (c === "clips") { let h = ""; try { h = new URL(d.url).hostname.toLowerCase().replace(/^(www\.|mobile\.|m\.)/, ""); } catch {} if (!["x.com", "twitter.com", "kick.com", "clips.kick.com"].includes(h)) return J({ error: "Only X (Twitter) and Kick clip links are allowed." }, 400); }
    if (c === "clips" && (!d.title || !d.streamer)) return J({ error: "fields" }, 400);
    m[id] = d; await s.setJSON(c, m); return J({ id });
  }
  if (op === "set") {
    if (!goodId(rawId)) return J({ error: "path" }, 400);
    const isVote = c === "votes" || c === "pollvotes";   // voters may only write their own doc
    if (!owner && !isVote) return J({ error: "owner only" }, 403);
    if (isVote) {
      if (!owner) {
        if (!/^[a-z0-9]{8,40}$/.test(rawId)) return J({ error: "id" }, 400);
        if (limited(req, "vote", 120, 600000)) return J({ error: "Slow down a little." }, 429);
        if (!(rawId in m) && Object.keys(m).length >= 4000) return J({ error: "full" }, 400);
      }
      const src = (data && data.v && typeof data.v === "object") ? data.v : {}, v = {};
      let n = 0;
      if (c === "pollvotes") {   // one choice (0-9) per poll
        for (const k of Object.keys(src)) { if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || BAD_IDS.has(k)) continue; const x = src[k]; if (Number.isInteger(x) && x >= 0 && x <= 9) { v[k] = x; if (++n >= 100) break; } }
      } else {
        for (const k of Object.keys(src)) { if (!/^[A-Za-z0-9_-]{1,40}$/.test(k) || BAD_IDS.has(k)) continue; if (src[k] === 1 || src[k] === -1) { v[k] = src[k]; if (++n >= 300) break; } }
      }
      m[rawId] = { v };
    }
    else m[rawId] = data;
    await s.setJSON(c, m); return J({ ok: true });
  }
  if (op === "delete") {
    if (!owner) return J({ error: "owner only" }, 403);
    if (!goodId(rawId)) return J({ error: "path" }, 400);
    delete m[rawId]; await s.setJSON(c, m); return J({ ok: true });
  }
  return J({ error: "op" }, 400);
};
