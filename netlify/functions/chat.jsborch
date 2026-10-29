import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/chat" };
// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const LINK_RE = /(https?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\s?(\.|\[\.\]|\(dot\)|\sdot\s)\s?(com|net|org|io|gg|tv|co|me|ly|xyz|app|to|link|us|uk|ca|info|biz|dev|live|ai|fm|gl|be|ee|ru|cc|ws|vip|shop|site|online|store|club|tk|ml|cf|ga|gq|gd|sh|st|im|is|it|de|fr|nl|se|pl|br|in|jp|cn|kr|au)\b)/i;
const hasLink = t => LINK_RE.test(String(t));
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
      return J({ ok: true, found: true, uid, name, messages: out, mute: mutes[uid] ? { until: mutes[uid].until || 0, ban: !!mutes[uid].ban } : null, history: hist });
    }
    if (q.has("before")) {
      const before = Number(q.get("before")) || Date.now(), limit = Math.max(1, Math.min(Number(q.get("limit")) || 50, 100));
      const { out, more } = await archBefore(s, before, limit);
      return J({ older: out.map(m => owner ? m : { id: m.id, name: m.name, text: m.text, t: m.t, badge: m.badge }), more });
    }
    const me = await sessionUser(req, s);
    const mutes = activeMutes(await s.get("mutes", { type: "json" }));
    const cut = await clearedAt(s);
    const msgs = ((await s.get("chat", { type: "json" })) || []).filter(m => m.t > cut).slice(-SHOW);
    const out = msgs.map(m => owner ? m : { id: m.id, name: m.name, text: m.text, t: m.t, badge: m.badge });
    const r = { messages: out, me: me ? { id: me.id, name: me.name, mutedUntil: mutes[me.id] ? (mutes[me.id].until || -1) : 0, banned: !!(mutes[me.id] && mutes[me.id].ban) } : null };
    if (owner) r.mutes = Object.entries(mutes).map(([uid, v]) => ({ uid, name: v.name, until: v.until || 0, ban: !!v.ban }));
    return J(r);
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text(); if (raw.length > 4000) return J({ error: "Too big." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400);

  // ---- moderation (owner key required) ----
  if (["delete", "mute", "unmute", "clear", "erase", "purge"].includes(b.op)) {
    if (!owner) return J({ error: "owner only" }, 403);
    if (b.op === "delete") {
      const list = (await s.get("chat", { type: "json" })) || [];
      await s.setJSON("chat", list.filter(m => m.id !== String(b.id)));
      const d = dayOf(idTime(b.id) || Date.now()), day = (await s.get("arch/" + d, { type: "json" })) || [];
      if (day.length) await s.setJSON("arch/" + d, day.filter(m => m.id !== String(b.id)));
      return J({ ok: true });
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
  const last = (await s.get("last/" + me.id, { type: "json" })) || { t: 0 };
  if (Date.now() - last.t < GAP) return J({ error: "Slow down a little." }, 429);
  const text = String(b.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return J({ error: "Type a message first." }, 400);
  if (!owner && hasLink(text)) return J({ error: "Links aren’t allowed in chat." }, 400);
  await s.setJSON("last/" + me.id, { t: Date.now() });
  const msg = { id: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), uid: me.id, name: me.name, text, t: Date.now(), badge: owner ? "OWNER" : "" };
  const list = (await s.get("chat", { type: "json" })) || [];
  list.push(msg); await s.setJSON("chat", list.slice(-KEEP));
  await migrate(s); await archAdd(s, [msg]);
  return J({ ok: true, message: { id: msg.id, name: msg.name, text: msg.text, t: msg.t, badge: msg.badge } });
};
