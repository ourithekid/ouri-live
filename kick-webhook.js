import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/kick-webhook" };

const pub = () => getStore("ouri");            // site data (leaderboards are public)
const priv = () => getStore("ouri-private");   // never exposed by /api/db
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const num = s => { const m = String(s || "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; };

let keyPem = null;
async function publicKey() {
  if (keyPem) return keyPem;
  const r = await fetch("https://api.kick.com/public/v1/public-key");
  if (!r.ok) throw new Error("public-key " + r.status);
  const j = await r.json();
  keyPem = (j.data && j.data.public_key) || j.public_key;
  if (!keyPem) throw new Error("no public key");
  return keyPem;
}

// count one chat message and keep the Top 5 chatters (strong reads so quick messages don't overwrite each other)
const IGNORE = new Set(["botrix", "kickbot", "nightbot", "streamelements", "moobot", "buttbot"]);
async function chatCount(name, broadcaster) {
  if (!name) return;
  const key = String(name).toLowerCase();
  if (IGNORE.has(key) || key === String(broadcaster || "").toLowerCase()) return;
  const ps = getStore({ name: "ouri-private", consistency: "strong" });
  const cc = (await ps.get("chatcounts", { type: "json" })) || {};
  cc[key] = { name: (cc[key] && cc[key].name) || name, v: ((cc[key] && cc[key].v) || 0) + 1 };
  let all = Object.values(cc).sort((a, b) => b.v - a.v);
  if (all.length > 200) { const keep = {}; all.slice(0, 200).forEach(u => { keep[u.name.toLowerCase()] = u; }); all = Object.values(keep).sort((a, b) => b.v - a.v); await ps.setJSON("chatcounts", keep); }
  else await ps.setJSON("chatcounts", cc);
  const top = all.slice(0, 5).map(u => ({ name: u.name.slice(0, 40), n: u.v.toLocaleString("en-US") + (u.v === 1 ? " msg" : " msgs") }));
  const pubS = getStore({ name: "ouri", consistency: "strong" });
  const m = (await pubS.get("chatters", { type: "json" })) || {};
  m.top = { rows: top }; await pubS.setJSON("chatters", m);
}

async function log(entry) {
  try {
    const p = priv(); const l = (await p.get("log", { type: "json" })) || [];
    l.unshift({ t: new Date().toISOString(), ...entry }); await p.setJSON("log", l.slice(0, 25));
  } catch {}
}

// add `add` to a person's running total and rebuild the Top 10 board
async function bump(kind, name, add) {
  if (!name || !(add > 0)) return;
  const s = pub();
  const tot = (await s.get("totals", { type: "json" })) || {};
  const board = (await s.get("board", { type: "json" })) || {};
  const users = (tot[kind] && tot[kind].users) || {};
  for (const r of ((board[kind] && board[kind].rows) || [])) {      // manual edits on the site win
    const k = String(r.name).toLowerCase(); users[k] = { name: r.name, v: num(r.n) };
  }
  const key = String(name).toLowerCase();
  users[key] = { name: (users[key] && users[key].name) || name, v: ((users[key] && users[key].v) || 0) + add };
  const all = Object.values(users).sort((a, b) => b.v - a.v);
  const keep = {}; all.slice(0, 300).forEach(u => { keep[u.name.toLowerCase()] = u; });
  const fmt = v => kind === "subs" ? v + (v === 1 ? " sub" : " subs") : v.toLocaleString("en-US") + " KICKs";
  tot[kind] = { users: keep };
  board[kind] = { rows: all.slice(0, 10).map(u => ({ name: u.name.slice(0, 40), n: fmt(u.v) })) };
  await s.setJSON("totals", tot); await s.setJSON("board", board);
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {                                       // owner-only debug view
    if (!process.env.OWNER_KEY || url.searchParams.get("debug") !== process.env.OWNER_KEY) return J({ ok: true, hint: "kick webhook endpoint" });
    return J({ log: (await priv().get("log", { type: "json" })) || [], auth: (await priv().get("auth", { type: "json" })) ? "connected" : "not connected" });
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);

  const raw = await req.text();
  const id = req.headers.get("kick-event-message-id") || "";
  const ts = req.headers.get("kick-event-message-timestamp") || "";
  const sig = req.headers.get("kick-event-signature") || "";
  const type = req.headers.get("kick-event-type") || "";

  let ok = false;
  try { ok = crypto.createVerify("RSA-SHA256").update(id + "." + ts + "." + raw).verify(await publicKey(), sig, "base64"); } catch (e) { await log({ type, verified: false, note: "verify error: " + e.message }); return J({ error: "verify" }, 401); }
  if (!ok) { await log({ type, verified: false, note: "bad signature" }); return J({ error: "signature" }, 401); }

  if (type === "chat.message.sent") {                              // no dedupe/log here: this fires on every chat message
    try { const cb = JSON.parse(raw); await chatCount((cb.sender || {}).username, (cb.broadcaster || {}).username); } catch {}
    return J({ ok: true });
  }

  const p = priv();
  const seen = (await p.get("seen", { type: "json" })) || [];
  if (id && seen.includes(id)) return J({ ok: true, dup: true });
  seen.unshift(id); await p.setJSON("seen", seen.slice(0, 300));

  let b; try { b = JSON.parse(raw); } catch { return J({ error: "json" }, 400); }
  try {
    if (type === "channel.subscription.gifts") {
      const g = b.gifter || {};
      if (!g.is_anonymous && g.username) await bump("subs", g.username, Array.isArray(b.giftees) && b.giftees.length ? b.giftees.length : 1);
      await log({ type, verified: true, note: (g.is_anonymous ? "anonymous" : g.username) + " x" + ((b.giftees || []).length || 1) });
    } else if (type === "kicks.gifted") {
      const sd = b.sender || {}, amt = Number((b.gift || {}).amount || 0);
      await bump("kicks", sd.username, amt);
      await log({ type, verified: true, note: sd.username + " " + amt });
    } else if (type === "livestream.status.updated") {
      // stream ended -> add a "waiting for a link" entry in the VODS tab (owner attaches the Kick VOD link later)
      if (b.is_live === false) {
        const ps = getStore({ name: "ouri-private", consistency: "strong" });
        const list = (await ps.get("vods", { type: "json" })) || [];
        const ended = b.ended_at || new Date().toISOString();
        if (!list.some(v => v.ended === ended)) {
          list.push({ id: Date.now().toString(36) + crypto.randomBytes(2).toString("hex"), title: String(b.title || "Stream").replace(/[<>]/g, "").slice(0, 100), pub: false, created: Date.now(), started: b.started_at || null, ended });
          await ps.setJSON("vods", list.slice(-100));
        }
      }
      await log({ type, verified: true, note: b.is_live === false ? "stream ended -> VOD draft" : "stream started" });
    } else await log({ type, verified: true, note: "ignored" });
  } catch (e) { await log({ type, verified: true, note: "error: " + e.message }); }
  return J({ ok: true });
};
