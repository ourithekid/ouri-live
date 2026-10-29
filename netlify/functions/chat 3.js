import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/chat" };
// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const LINK_RE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\s?(\.|\[\.\]|\(dot\)|\sdot\s)\s?(com|net|org|io|gg|tv|co|me|ly|xyz|app|to|link|us|uk|ca|info|biz|dev|live|ai|fm|gl|be|ee|ru|cc|ws|vip|shop|site|online|store|club|tk|ml|cf|ga|gq|gd|sh|st|im|is|it|de|fr|nl|se|pl|br|in|jp|cn|kr|au)\b)/i;
// Kick clip links are the only links allowed in chat
const KICK_CLIP = /https?:\/\/(?:www\.)?kick\.com\/[A-Za-z0-9_-]{1,40}(?:\/clips\/clip_[A-Za-z0-9]{6,40}|\?clip=clip_[A-Za-z0-9]{6,40})(?:[?&#][A-Za-z0-9_=&%.-]{0,120})?/gi;
const hasLink = t => LINK_RE.test(String(t).replace(KICK_CLIP, " "));
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const hits = new Map();
const limited = (req, key, max, ms) => { const ip = String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };


const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const KEEP = 300, SHOW = 80, GAP = 2000;
// ---- permanent archive: every message is also kept in one blob per day ("arch/YYYY-MM-DD"), never trimmed ----
const dayOf = t => new Date(t).toISOString().slice(0, 10);
const idTime = id => { const n = parseInt(String(id).slice(0, 8), 36); return Number.isFinite(n) ? n : 0; };
async function archAdd(s, msgs) {
  const by = {}; for (const m of msgs) (by[dayOf(m.t)] ||= []).push(m);
  for (const [d, add] of Object.entries(by)) {
    const cur = (await s.get("arch/" + d, { type: "json" })) || [], seen = new Set(cur.map(m => m.id));
    for (const m of add) if (!seen.has(m.id)) cur.push(m);
    cur.sort((a, b) => a.t - b.t); await s.setJSON("arch/" + d, cur);
  }
}
async function migrate(s) { // one time: copy whatever is in the live list into the archive
  if (await s.get("arch-migrated", { type: "json" })) return;
  const list = (await s.get("chat", { type: "json" })) || []; if (list.length) await archAdd(s, list);
  await s.setJSON("arch-migrated", { t: Date.now() });
}
async function logMod(s, e) { const l = (await s.get("modlog", { type: "json" })) || []; l.push({ t: Date.now(), ...e }); await s.setJSON("modlog", l.slice(-1000)); }
async function userLog(s, key, max) { // every message one account has posted, oldest first (owner only)
  const uidKey = /^[a-f0-9]{16}$/.test(key), nm = key.toLowerCase();
  const hit = m => uidKey ? m.uid === key : String(m.name || "").toLowerCase() === nm;
  let out = [], uid = uidKey ? key : "", name = "";
  const take = arr => { for (const m of arr) if (m.uid && hit(m)) { uid = uid || m.uid; name = m.name; out.push(m); } };
  await migrate(s);
  const { blobs } = await s.list({ prefix: "arch/" });
  for (const d of blobs.map(b => b.key).sort().reverse()) { take((await s.get(d, { type: "json" })) || []); if (out.length >= max) break; }
  const seen = new Set(); out = out.filter(m => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => a.t - b.t).slice(-max);
  return { uid, name, out };
}
const clearedAt = async s => ((await s.get("clearedAt", { type: "json" })) || {}).t || 0;
async function archBefore(s, before, limit) { // newest first walk back through the day files
  await migrate(s); const cut = await clearedAt(s);
  const { blobs } = await s.list({ prefix: "arch/" });
  const days = blobs.map(b => b.key.slice(5)).filter(d => d <= dayOf(before) && d >= dayOf(cut)).sort().reverse();
  let out = [], more = false;
  for (let i = 0; i < days.length; i++) {
    const arr = ((await s.get("arch/" + days[i], { type: "json" })) || []).filter(m => m.t < before && m.t > cut);
    out = arr.concat(out);
    if (out.length >= limit) { more = out.length > limit || i < days.length - 1; out = out.slice(-limit); break; }
  }
  return { out, more };
}

async function sessionUser(req, s) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ouri_sess=([a-f0-9]{64})/); if (!m) return null;
  const se = await s.get("sess/" + sha(m[1]), { type: "json" }); if (!se || se.exp < Date.now()) return null;
  const u = await s.get("acct/" + se.e, { type: "json" }); return u ? { id: u.id, name: u.name } : null;
}
// ---- extras: settings, badges, name colors, reactions, presence ----
const EMOJI = ["🔥","😂","❤️","👍","💀","👀"];
const COLORS = ["#ff5c5c","#ff9f43","#ffd23f","#53fc18","#2ee6a6","#35c9ff","#6c8cff","#b57bff","#ff6bd6","#ffffff"];
const BADGES = ["MOD","VIP","SUB","OG"];
const getCfg = async s => { const c = (await s.get("cfg", { type: "json" })) || {}; return { slow: Math.max(0, Math.min(Number(c.slow) || 0, 300)), words: Array.isArray(c.words) ? c.words.slice(0, 300) : [], pin: c.pin || null }; };
const norm = t => String(t).toLowerCase().replace(/[@4]/g, "a").replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/[$5]/g, "s").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
function badWord(text, words) {
  const t = norm(text), sq = t.replace(/ /g, "");
  for (const w of words) {
    const n = norm(w); if (!n) continue;
    if ((" " + t + " ").includes(" " + n + " ")) return true;
    if (n.replace(/ /g, "").length >= 5 && sq.includes(n.replace(/ /g, ""))) return true;
  }
  return false;
}
const snip = t => String(t).replace(/\s+/g, " ").slice(0, 70);
async function maps(s) { return { badges: (await s.get("badges", { type: "json" })) || {}, colors: (await s.get("colors", { type: "json" })) || {}, reacts: (await s.get("reacts", { type: "json" })) || {} }; }
const rxOf = (r, id, uid) => { const o = {}; const e = (r || {})[id]; if (!e) return undefined; for (const [k, a] of Object.entries(e)) if (a.length) o[k] = [a.length, uid ? a.includes(uid) : false]; return Object.keys(o).length ? o : undefined; };
const pubMsg = (m, mp, uid, owner) => { const o = { id: m.id, name: m.name, text: m.text, t: m.t, badge: m.badge === "OWNER" ? "OWNER" : (mp.badges[m.uid] || m.badge || ""), color: mp.colors[m.uid] || "" };
  if (m.reply) o.reply = m.reply; const rx = rxOf(mp.reacts, m.id, uid); if (rx) o.rx = rx; if (owner) o.uid = m.uid; return o; };
async function presence(s, sid) {
  try {
    const now = Date.now(); let p = (await s.get("presence", { type: "json" })) || {}, dirty = false;
    if (sid && (!p[sid] || now - p[sid] > 25000)) { p[sid] = now; dirty = true; }
    for (const k of Object.keys(p)) if (now - p[k] > 90000) { delete p[k]; dirty = true; }
    if (dirty) await s.setJSON("presence", p);
    return Object.values(p).filter(t => now - t < 70000).length;
  } catch { return 0; }
}
const activeMutes = m => { const out = {}, now = Date.now(); for (const [k, v] of Object.entries(m || {})) if (!v.until || v.until > now) out[k] = v; return out; };

export default async (req) => {
  const s = st();
  const owner = isOwnerReq(req);

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    if (q.has("log")) {
      if (!owner) return J({ error: "owner only" }, 403);
      const key = String(q.get("log") || "").trim().slice(0, 40); if (!key) return J({ error: "name" }, 400);
      const { uid, name, out } = await userLog(s, key, 400);
      if (!uid) return J({ ok: true, found: false });
      const mutes = activeMutes(await s.get("mutes", { type: "json" })), hist = ((await s.get("modlog", { type: "json" })) || []).filter(e => e.uid === uid).slice(-50);
      const bmap = (await s.get("badges", { type: "json" })) || {};
      return J({ ok: true, found: true, uid, name, badge: bmap[uid] || "", messages: out, mute: mutes[uid] ? { until: mutes[uid].until || 0, ban: !!mutes[uid].ban } : null, history: hist });
    }
    if (q.has("before")) {
      const before = Number(q.get("before")) || Date.now(), limit = Math.max(1, Math.min(Number(q.get("limit")) || 50, 100));
      const { out, more } = await archBefore(s, before, limit);
      const mp = await maps(s), me0 = await sessionUser(req, s);
      return J({ older: out.map(m => pubMsg(m, mp, me0 && me0.id, owner)), more });
    }
    const me = await sessionUser(req, s);
    const mutes = activeMutes(await s.get("mutes", { type: "json" }));
    const cut = await clearedAt(s);
    const msgs = ((await s.get("chat", { type: "json" })) || []).filter(m => m.t > cut).slice(-SHOW);
    const mp = await maps(s), cfg = await getCfg(s);
    const out = msgs.map(m => pubMsg(m, mp, me && me.id, owner));
    const sid = String(q.get("sid") || ""), online = await presence(s, /^[a-z0-9]{6,20}$/.test(sid) ? sid : "");
    const r = { messages: out, slow: cfg.slow, pin: cfg.pin, online, me: me ? { id: me.id, name: me.name, color: mp.colors[me.id] || "", mutedUntil: mutes[me.id] ? (mutes[me.id].until || -1) : 0, banned: !!(mutes[me.id] && mutes[me.id].ban) } : null };
    if (owner) { r.words = cfg.words; }
    if (owner) r.mutes = Object.entries(mutes).map(([uid, v]) => ({ uid, name: v.name, until: v.until || 0, ban: !!v.ban }));
    return J(r);
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text(); if (raw.length > 4000) return J({ error: "Too big." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400);

  // ---- moderation (owner key required) ----
  if (["delete", "mute", "unmute", "clear", "erase", "purge", "cfg", "pin", "unpin", "badge"].includes(b.op)) {
    if (!owner) return J({ error: "owner only" }, 403);
    if (b.op === "delete") {
      const list = (await s.get("chat", { type: "json" })) || [];
      await s.setJSON("chat", list.filter(m => m.id !== String(b.id)));
      const d = dayOf(idTime(b.id) || Date.now()), day = (await s.get("arch/" + d, { type: "json" })) || [];
      if (day.length) await s.setJSON("arch/" + d, day.filter(m => m.id !== String(b.id)));
      return J({ ok: true });
    }
    if (b.op === "cfg") {
      const cur = await getCfg(s), slow = b.slow == null ? cur.slow : Math.max(0, Math.min(Number(b.slow) || 0, 300));
      const words = b.words == null ? cur.words : String(Array.isArray(b.words) ? b.words.join("\n") : b.words).split(/[\n,]+/).map(x => x.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 300);
      await s.setJSON("cfg", { slow, words, pin: cur.pin }); return J({ ok: true, slow, words });
    }
    if (b.op === "pin" || b.op === "unpin") {
      const cur = await getCfg(s); let pin = null;
      if (b.op === "pin") { const text = String(b.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); if (!text) return J({ error: "Type something to pin." }, 400); pin = { text, by: String(b.name || "").slice(0, 20), t: Date.now() }; }
      await s.setJSON("cfg", { slow: cur.slow, words: cur.words, pin }); return J({ ok: true, pin });
    }
    if (b.op === "badge") {
      const uid = String(b.uid || ""); if (!/^[a-f0-9]{16}$/.test(uid)) return J({ error: "uid" }, 400);
      const bd = (await s.get("badges", { type: "json" })) || {}, v = String(b.badge || "").toUpperCase();
      if (v && !BADGES.includes(v)) return J({ error: "badge" }, 400);
      if (v) bd[uid] = v; else delete bd[uid]; await s.setJSON("badges", bd); return J({ ok: true });
    }
    if (b.op === "clear") { await s.setJSON("clearedAt", { t: Date.now() }); return J({ ok: true }); } // hides everything older; archive is kept
    if (b.op === "erase") { // wipes the live chat AND the permanent history
      await s.setJSON("chat", []); await s.setJSON("clearedAt", { t: Date.now() });
      const { blobs } = await s.list({ prefix: "arch/" }); for (const x of blobs) await s.delete(x.key);
      return J({ ok: true });
    }
    if (b.op === "purge") { // remove every message from one person
      const uid = String(b.uid || ""); if (!/^[a-f0-9]{16}$/.test(uid)) return J({ error: "uid" }, 400);
      await s.setJSON("chat", ((await s.get("chat", { type: "json" })) || []).filter(m => m.uid !== uid));
      const { blobs } = await s.list({ prefix: "arch/" });
      for (const x of blobs) { const arr = (await s.get(x.key, { type: "json" })) || []; const keep = arr.filter(m => m.uid !== uid); if (keep.length !== arr.length) await s.setJSON(x.key, keep); }
      return J({ ok: true });
    }
    const mutes = (await s.get("mutes", { type: "json" })) || {};
    if (b.op === "mute") {
      const uid = String(b.uid || ""); if (!/^[a-f0-9]{16}$/.test(uid)) return J({ error: "uid" }, 400);
      const mins = Math.max(0, Math.min(Number(b.minutes) || 0, 525600));
      const ban = b.ban === true, nm = String(b.name || "").slice(0, 20);
      mutes[uid] = { name: nm, until: !ban && mins ? Date.now() + mins * 60000 : 0, ban, t: Date.now() };
      await logMod(s, { uid, name: nm, op: ban ? "ban" : "timeout", mins: ban ? 0 : mins });
    } else { const uid = String(b.uid || ""); await logMod(s, { uid, name: (mutes[uid] || {}).name || "", op: "lift" }); delete mutes[uid]; }
    await s.setJSON("mutes", activeMutes(mutes)); return J({ ok: true });
  }

  // ---- posting (account required) ----
  if (limited(req, "chat", 40, 60000)) return J({ error: "Slow down a little." }, 429);
  const me = await sessionUser(req, s);
  if (!me) return J({ error: "Log in to chat." }, 401);
  const mutes = activeMutes(await s.get("mutes", { type: "json" }));
  if (mutes[me.id]) return J({ error: mutes[me.id].ban ? "You’ve been banned from chat." : "You’re timed out for a bit. Try again soon.", muted: true }, 403);
  if (b.op === "color") {
    const col = String(b.color || ""); const cs = (await s.get("colors", { type: "json" })) || {};
    if (col && !COLORS.includes(col)) return J({ error: "color" }, 400);
    if (col) cs[me.id] = col; else delete cs[me.id]; await s.setJSON("colors", cs); return J({ ok: true, color: col });
  }
  if (b.op === "react") {
    const id = String(b.id || ""), em = String(b.emoji || ""); if (!/^[a-z0-9]{6,24}$/.test(id) || !EMOJI.includes(em)) return J({ error: "Bad request." }, 400);
    const rx = (await s.get("reacts", { type: "json" })) || {}, e = (rx[id] ||= {}), a = (e[em] ||= []), i = a.indexOf(me.id);
    if (i >= 0) a.splice(i, 1); else if (a.length < 300) a.push(me.id);
    if (!a.length) delete e[em]; if (!Object.keys(e).length) delete rx[id];
    const keys = Object.keys(rx); if (keys.length > 800) for (const k of keys.sort((x, y) => idTime(x) - idTime(y)).slice(0, keys.length - 800)) delete rx[k];
    await s.setJSON("reacts", rx); return J({ ok: true, rx: rxOf(rx, id, me.id) || {} });
  }
  const cfg = await getCfg(s);
  const last = (await s.get("last/" + me.id, { type: "json" })) || { t: 0 };
  const gap = owner ? 0 : Math.max(GAP, cfg.slow * 1000), wait = gap - (Date.now() - last.t);
  if (wait > 0) return J({ error: cfg.slow ? "Slow mode is on. Wait " + Math.ceil(wait / 1000) + "s." : "Slow down a little.", wait: Math.ceil(wait / 1000) }, 429);
  const text = String(b.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return J({ error: "Type a message first." }, 400);
  if (!owner && hasLink(text)) return J({ error: "Only Kick clip links are allowed in chat." }, 400);
  if (!owner && cfg.words.length && badWord(text, cfg.words)) return J({ error: "That message has a word that isn’t allowed here." }, 400);
  let reply = null;
  if (b.reply && /^[a-z0-9]{6,24}$/.test(String(b.reply))) { const src = ((await s.get("chat", { type: "json" })) || []).find(x => x.id === String(b.reply)); if (src) reply = { id: src.id, name: src.name, text: snip(src.text) }; }
  await s.setJSON("last/" + me.id, { t: Date.now() });
  const msg = { id: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), uid: me.id, name: me.name, text, t: Date.now(), badge: owner ? "OWNER" : "" }; if (reply) msg.reply = reply;
  const list = (await s.get("chat", { type: "json" })) || [];
  list.push(msg); await s.setJSON("chat", list.slice(-KEEP));
  await migrate(s); await archAdd(s, [msg]);
  const mp = { badges: (await s.get("badges", { type: "json" })) || {}, colors: (await s.get("colors", { type: "json" })) || {}, reacts: {} };
  return J({ ok: true, message: pubMsg(msg, mp, me.id, false) });
};
