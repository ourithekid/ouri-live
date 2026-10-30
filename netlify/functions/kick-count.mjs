import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/kick-count" };
// Counts Kick chat messages that the OWNER's open browser tab relays here (no Kick API keys needed).
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const IGNORE = new Set(["botrix", "kickbot", "nightbot", "streamelements", "moobot", "buttbot"]);
const isBot = n => IGNORE.has(String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
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
  let n = 0;
  for (const m of msgs) {
    const id = String(m && m.id || ""), name = String(m && m.name || "").slice(0, 40), key = name.toLowerCase();
    if (!name || !id || seenSet.has(id) || isBot(key) || key === "ouri") continue;
    seenSet.add(id); seen.unshift(id); n++;
    cc[key] = { name: (cc[key] && cc[key].name) || name, v: ((cc[key] && cc[key].v) || 0) + 1 };
  }
  if (!n) return J({ ok: true, counted: 0 });
  await ps.setJSON("seenmsg", seen.slice(0, 600));
  let all = Object.values(cc).sort((a, b2) => b2.v - a.v), keep = cc;
  if (all.length > 200) { keep = {}; all.slice(0, 200).forEach(u => { keep[u.name.toLowerCase()] = u; }); all = Object.values(keep).sort((a, b2) => b2.v - a.v); }
  await ps.setJSON("chatcounts", keep);
  const top = all.slice(0, 10).map(u => ({ name: u.name.slice(0, 40), n: u.v.toLocaleString("en-US") + (u.v === 1 ? " msg" : " msgs") }));
  const pubS = getStore({ name: "ouri", consistency: "strong" });
  const m = (await pubS.get("chatters", { type: "json" })) || {};
  m.top = { rows: top }; m.meta = { last: new Date().toISOString(), n: ((m.meta && m.meta.n) || 0) + n, via: "owner-browser" };
  await pubS.setJSON("chatters", m);
  return J({ ok: true, counted: n });
};
