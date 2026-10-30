import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/kick-count" };
// Counts Kick chat messages that the OWNER's open browser tab relays here (no Kick API keys needed).
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const IGNORE = new Set(["botrix", "kickbot", "nightbot", "streamelements", "moobot", "buttbot"]);
const isBot = n => IGNORE.has(String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""));

const etDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const etWk = () => { const d = new Date(etDay() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const etMo = () => etDay().slice(0, 7);
const bump1 = (cc, key, name, wk, mo) => { const x = cc[key] || (cc[key] = { name, v: 0 }); x.name = x.name || name; x.v = (x.v || 0) + 1; if (!x.w || x.w.k !== wk) x.w = { k: wk, v: 0 }; x.w.v++; if (!x.m || x.m.k !== mo) x.m = { k: mo, v: 0 }; x.m.v++; };
const rowsOf = (cc, f, pick) => Object.values(cc).map(u => ({ u, v: pick(u) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 10).map(x => ({ name: x.u.name.slice(0, 40), n: x.v.toLocaleString("en-US") + (x.v === 1 ? " msg" : " msgs") }));
const publish = async (cc, n, via) => {
  const wk = etWk(), mo = etMo(), pubS = getStore({ name: "ouri", consistency: "strong" }), m = (await pubS.get("chatters", { type: "json" })) || {};
  m.top = { rows: rowsOf(cc, 0, u => u.v) }; m.topW = { wk, rows: rowsOf(cc, 0, u => u.w && u.w.k === wk ? u.w.v : 0) }; m.topM = { mk: mo, rows: rowsOf(cc, 0, u => u.m && u.m.k === mo ? u.m.v : 0) };
  m.meta = { last: new Date().toISOString(), n: ((m.meta && m.meta.n) || 0) + n, via };
  await pubS.setJSON("chatters", m);
};
let roomCache = null, roomAt = 0;
async function room() {
  if (roomCache && Date.now() - roomAt < 3600000) return roomCache;
  const r = await fetch("https://kick.com/api/v2/channels/ouri", { headers: { "user-agent": "Mozilla/5.0 (compatible; OuriSite/1.0)", accept: "application/json" } });
  if (!r.ok) throw new Error("kick " + r.status);
  const j = await r.json(); const id = j && j.chatroom && j.chatroom.id; if (!id) throw new Error("no chatroom id");
  roomCache = id; roomAt = Date.now(); return id;
}
export default async (req) => {
  if (req.method === "GET") { try { return J({ ok: true, room: await room() }); } catch (e) { return J({ ok: false, error: String(e.message || e) }, 502); } }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!process.env.OWNER_KEY || !eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY)) return J({ error: "owner only" }, 403);
  let b; try { b = await req.json(); } catch { return J({ error: "json" }, 400); }
  const msgs = Array.isArray(b.msgs) ? b.msgs.slice(0, 200) : [];
  if (!msgs.length) return J({ ok: true, counted: 0 });
  const ps = getStore({ name: "ouri-private", consistency: "strong" });
  const seen = (await ps.get("seenmsg", { type: "json" })) || [], seenSet = new Set(seen);
  const cc = (await ps.get("chatcounts", { type: "json" })) || {};
  let n = 0; const wk = etWk(), mo = etMo();
  for (const m of msgs) {
    const id = String(m && m.id || ""), name = String(m && m.name || "").slice(0, 40), key = name.toLowerCase();
    if (!name || !id || seenSet.has(id) || isBot(key) || key === "ouri") continue;
    seenSet.add(id); seen.unshift(id); n++; bump1(cc, key, name, wk, mo);
  }
  if (!n) return J({ ok: true, counted: 0 });
  await ps.setJSON("seenmsg", seen.slice(0, 600));
  let keep = cc; const all = Object.values(cc).sort((a, b2) => b2.v - a.v);
  if (all.length > 400) { keep = {}; all.slice(0, 400).forEach(u => { keep[u.name.toLowerCase()] = u; }); }
  await ps.setJSON("chatcounts", keep);
  await publish(keep, n, "owner-browser");
  return J({ ok: true, counted: n });
};
