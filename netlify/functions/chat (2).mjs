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
const limited = (req, key, max, ms) => { const ip = String((req.headers.get("cf-connecting-ip") || req.headers.get("x-nf-client-connection-ip")) || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };


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
const BADGES = ["MOD","VIP","SUB","OG","VERIFIED","OURI"];
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
// ---- points + levels: +2 per message (every 20s, up to 200/day), daily check-in with a streak bonus ----
const etDay = (off = 0) => new Date(Date.now() - off).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const lvOf = p => 1 + Math.floor(Math.sqrt(Math.max(0, p) / 40));
// weekly (Monday start, New York time) and monthly point + message counters; they roll over by themselves
const wkKey = () => { const d = new Date(etDay() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const moKey = () => etDay().slice(0, 7);
const bump = (r, n, m) => { const w = wkKey(), mo = moKey(); if (!r.w || r.w.k !== w) r.w = { k: w, p: 0, m: 0 }; if (!r.mo || r.mo.k !== mo) r.mo = { k: mo, p: 0, m: 0 }; r.w.p += n; r.mo.p += n; r.w.m += m; r.mo.m += m; };
const addP = (r, n) => { r.p += n; bump(r, n, 0); };
const newRec = () => ({ p: 0, st: 0, ci: "", d: "", dp: 0, t: 0, n: "", vids: [], upc: 0, mc: 0, j: Date.now(), q: { d: "", m: 0, v: [], u: 0, pm: 0, pv: 0, pu: 0 } });
const recOf = (pt, me) => { const r = (pt[me.id] ||= newRec()); r.n = me.name; r.vids ||= []; r.upc ||= 0; const day = etDay(); if (!r.q || r.q.d !== day) r.q = { d: day, m: 0, v: [], u: 0, pm: 0, pv: 0, pu: 0 }; return r; };
const questPay = r => { let g = 0; const q = r.q; if (!q.pm && q.m >= 10) { q.pm = 1; g += 15; } if (!q.pv && q.v.length >= 3) { q.pv = 1; g += 5; } if (!q.pu && q.u >= 1) { q.pu = 1; g += 5; } addP(r, g); return g; };
const REWARDS = [{ lv: 5, t: "Premium name colors" }, { lv: 10, t: "REGULAR badge" }, { lv: 15, t: "More premium colors" }, { lv: 20, t: "Glowing name" }, { lv: 25, t: "ELITE badge" }, { lv: 50, t: "LEGEND badge" }];
const PREM = [["#ffe066", 5], ["#7df9ff", 5], ["#ff4d9d", 15], ["#a6ff00", 15]];
const autoBadge = lv => lv >= 50 ? "LEGEND" : lv >= 25 ? "ELITE" : lv >= 10 ? "REGULAR" : "";
const ptsInfo = (r, day) => { const p = (r && r.p) || 0, lv = lvOf(p), lo = 40 * (lv - 1) * (lv - 1), hi = 40 * lv * lv, q = r && r.q && r.q.d === day ? r.q : { m: 0, v: [], u: 0, pm: 0, pv: 0, pu: 0 }, nr = REWARDS.find(x => x.lv > lv);
  return { p, lv, cur: p - lo, need: hi - lo, st: (r && (r.ci === day || r.ci === etDay(86400000))) ? (r.st || 0) : 0, can: !(r && r.ci === day), linked: !!(r && r.vids && r.vids.length),
    quests: [{ k: "m", l: "Send 10 messages", n: Math.min(q.m, 10), max: 10, pts: 15, done: !!q.pm }, { k: "v", l: "Vote on 3 clips", n: Math.min(q.v.length, 3), max: 3, pts: 5, done: !!q.pv }, { k: "u", l: "Upload a clip", n: Math.min(q.u, 1), max: 1, pts: 5, done: !!q.pu }],
    next: nr ? { lv: nr.lv, t: nr.t } : null }; };
// +1 point for every upvote on one of your clips from somebody else (your own votes never count)
async function syncUps(r) {
  if (!r.vids.length) return 0;
  const db = getStore("ouri"), clips = (await db.get("clips", { type: "json" })) || {}, votes = (await db.get("votes", { type: "json" })) || {}, mine = new Set(r.vids);
  const ids = Object.keys(clips).filter(id => mine.has(clips[id] && clips[id].by)); let U = 0;
  for (const [voter, d] of Object.entries(votes)) { if (mine.has(voter)) continue; const v = (d && d.v) || {}; for (const id of ids) if (v[id] === 1) U++; }
  const gain = Math.max(0, U - (r.upc || 0)); if (gain) { addP(r, gain); r.upc = U; } return gain;
}
const fmtMs = ms => { const m = Math.floor(ms / 60000), h = Math.floor(m / 60); return h ? h + "h " + (m % 60) + "m" : m + "m"; };
async function botReply(cmd, c) {
  const { me, pt, pr, req, s } = c, day = etDay(), info = ptsInfo(pr, day), at = "@" + me.name + ": ", rank = () => Object.values(pt).filter(x => (x.p || 0) > pr.p).length + 1;
  switch (cmd) {
    case "points": case "level": case "lvl": case "rank": return at + "Level " + info.lv + " · " + info.p.toLocaleString() + " points · #" + rank() + " on the points board · " + (info.need - info.cur) + " points to level " + (info.lv + 1) + ".";
    case "streak": return at + (info.st > 0 ? "🔥 " + info.st + "-day check-in streak." : "No streak yet. Hit the daily check-in to start one!");
    case "daily": case "quests": return at + info.quests.map(x => x.l + " " + x.n + "/" + x.max + (x.done ? " ✓" : "")).join(" · ") + " · Check-in " + (info.can ? "ready" : "done ✓");
    case "top": { const t = Object.values(pt).filter(x => x.n && x.p > 0).sort((a, b) => b.p - a.p).slice(0, 3).map((x, i) => (i + 1) + ". " + x.n + " (Lv " + lvOf(x.p) + ")").join("   "); return t ? "Top points: " + t : "Nobody is on the points board yet. Be the first!"; }
    case "uptime": try { const j = await (await fetch(new URL("/api/status", req.url))).json(); if (j && j.live) { const ms = j.started ? Date.now() - j.started : 0; return "Ouri is LIVE" + (ms > 60000 ? " and has been streaming for " + fmtMs(ms) : "") + (j.viewers != null ? " · " + j.viewers + " watching" : "") + "."; } return "Ouri is offline right now."; } catch { return "Couldn’t check the stream right now."; }
    case "clip": { const k = await s.get("kickclips", { type: "json" }).catch(() => null), x = k && k.clips && k.clips[0]; return x ? "Latest clip: " + x.title + " " + x.url : "Check the Clips tab for the latest clips!"; }
    case "socials": return "Kick: kick.com/ouri · Twitch: twitch.tv/ouri · YouTube: @OuriTheKid · TikTok, X and Instagram: OuriTheKid";
    case "lurk": return "@" + me.name + " is lurking 👀 Thanks for hanging out!";
    case "commands": case "help": return "Commands: !points !streak !daily !top !uptime !clip !socials !lurk";
  }
  return null;
}
async function maps(s) { return { badges: (await s.get("badges", { type: "json" })) || {}, colors: (await s.get("colors", { type: "json" })) || {}, reacts: (await s.get("reacts", { type: "json" })) || {}, pts: (await s.get("points", { type: "json" })) || {} }; }
const rxOf = (r, id, uid) => { const o = {}; const e = (r || {})[id]; if (!e) return undefined; for (const [k, a] of Object.entries(e)) if (a.length) o[k] = [a.length, uid ? a.includes(uid) : false]; return Object.keys(o).length ? o : undefined; };
const pubMsg = (m, mp, uid, owner) => { const lv = m.uid === "bot" ? 0 : lvOf(((mp.pts || {})[m.uid] || {}).p || 0); let badge = m.badge === "OWNER" ? "OWNER" : (mp.badges[m.uid] || m.badge || ""); const ab = (m.badge === "OWNER" || m.uid === "bot") ? "" : autoBadge(lv); if (ab && !badge.split(",").includes(ab)) badge = badge ? badge + "," + ab : ab;
  const o = { id: m.id, name: m.name, text: m.text, t: m.t, badge, color: mp.colors[m.uid] || "" }; if (lv) o.lv = lv;
  if (m.reply) o.reply = m.reply; const rx = rxOf(mp.reacts, m.id, uid); if (rx) o.rx = rx; if (owner) o.uid = m.uid; return o; };
const pubPoll = (p, uid) => { if (!p || !p.q) return null; const n = p.opts.map(() => 0); for (const v of Object.values(p.votes || {})) if (n[v] != null) n[v]++; return { id: p.id, q: p.q, opts: p.opts.map((t, i) => ({ t, n: n[i] })), total: n.reduce((a, b) => a + b, 0), open: !!p.open, mine: uid && p.votes && p.votes[uid] != null ? p.votes[uid] : -1, by: p.by || "" }; };
const badgeOf = (uid, mp) => { const r = mp.pts[uid] || {}, lv = lvOf(r.p || 0); let b = mp.badges[uid] || ""; const ab = autoBadge(lv); if (ab && !b.split(",").includes(ab)) b = b ? b + "," + ab : ab; return b; };
function spotOf(pt, mp, sp) {
  const wk = wkKey(), ents = Object.entries(pt).filter(([, x]) => x.n);
  let hit = null, manual = false;
  if (sp && sp.n) { hit = ents.find(([, x]) => x.n.toLowerCase() === sp.n.toLowerCase()) || null; manual = !!hit; }
  if (!hit) { hit = ents.filter(([, x]) => x.w && x.w.k === wk && x.w.p > 0).sort((a, b) => b[1].w.p - a[1].w.p)[0] || null; }
  if (!hit) return null; const [id, x] = hit;
  return { n: x.n, lv: lvOf(x.p), p: x.p, wp: x.w && x.w.k === wk ? x.w.p : 0, wm: x.w && x.w.k === wk ? x.w.m : 0, badge: badgeOf(id, mp), color: mp.colors[id] || "", note: manual ? String(sp.note || "") : "", manual };
}
async function presence(s, sid, uid, recent) {
  try {
    const now = Date.now(); const p = (await s.get("presence", { type: "json" })) || {}; let dirty = false;
    const cur = p[sid]; const t0 = cur && typeof cur === "object" ? cur.t : cur;
    if (sid && (!t0 || now - t0 > 25000 || (cur && typeof cur === "object" && cur.u !== (uid || "")))) { p[sid] = { t: now, u: uid || "" }; dirty = true; }
    for (const k of Object.keys(p)) { const t = p[k] && typeof p[k] === "object" ? p[k].t : p[k]; if (now - t > 90000) { delete p[k]; dirty = true; } }
    if (dirty) await s.setJSON("presence", p);
    const who = new Set();
    for (const [k, v] of Object.entries(p)) { const t = v && typeof v === "object" ? v.t : v, u = v && typeof v === "object" ? v.u : ""; if (now - t < 70000) who.add(u ? "u" + u : "s" + k); }
    for (const u of recent || []) who.add("u" + u);   // people who wrote in the last 5 minutes count too
    return who.size;
  } catch { return 0; }
}
const activeMutes = m => { const out = {}, now = Date.now(); for (const [k, v] of Object.entries(m || {})) if (!v.until || v.until > now) out[k] = v; return out; };

export default async (req) => {
  const s = st();
  const owner = isOwnerReq(req);

  if (req.method === "GET") {
    const q = new URL(req.url).searchParams;
    if (q.has("board")) {
      const pt = (await s.get("points", { type: "json" })) || {}, mp = await maps(s), wk = wkKey(), mk = moKey();
      const per = (f, key) => Object.values(pt).filter(x => x.n && x[f] && x[f].k === key && x[f].p > 0).sort((a, b) => b[f].p - a[f].p).slice(0, 10).map(x => ({ n: x.n, p: x[f].p, lv: lvOf(x.p) }));
      const chat = (f, key) => Object.values(pt).filter(x => x.n && x[f] && x[f].k === key && x[f].m > 0).sort((a, b) => b[f].m - a[f].m).slice(0, 10).map(x => ({ n: x.n, m: x[f].m }));
      return J({ board: Object.values(pt).filter(x => x.n && x.p > 0).sort((a, b) => b.p - a.p).slice(0, 10).map(x => ({ n: x.n, p: x.p, lv: lvOf(x.p) })), week: per("w", wk), month: per("mo", mk), chatWeek: chat("w", wk), chatMonth: chat("mo", mk), wk, mk, spot: spotOf(pt, mp, await s.get("spot", { type: "json" })) });
    }
    if (q.has("profile")) {
      const nm = String(q.get("profile") || "").trim().toLowerCase().slice(0, 24); if (!nm) return J({ error: "name" }, 400);
      const pt = (await s.get("points", { type: "json" })) || {}, mp = await maps(s), hit = Object.entries(pt).find(([, x]) => x.n && x.n.toLowerCase() === nm);
      if (!hit) return J({ ok: true, found: false });
      const [id, x] = hit, wk = wkKey(), rank = Object.values(pt).filter(y => (y.p || 0) > x.p).length + 1;
      return J({ ok: true, found: true, name: x.n, lv: lvOf(x.p), p: x.p, rank, wp: x.w && x.w.k === wk ? x.w.p : 0, msgs: x.mc || 0, st: ptsInfo(x, etDay()).st, ups: x.upc || 0, badge: badgeOf(id, mp), color: mp.colors[id] || "", joined: x.j || 0 });
    }
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
    if (q.get("ping")) {   // lightweight "I'm on the site" beacon from any tab
      const psid = String(q.get("sid") || "");
      const recent = ((await s.get("chat", { type: "json" })) || []).filter(m => Date.now() - m.t < 70000 && m.uid).map(m => m.uid);
      return J({ online: await presence(s, /^[a-z0-9]{6,20}$/.test(psid) ? psid : "", me && me.id, recent) });
    }
    const mutes = activeMutes(await s.get("mutes", { type: "json" }));
    const cut = await clearedAt(s);
    const msgs = ((await s.get("chat", { type: "json" })) || []).filter(m => m.t > cut).slice(-SHOW);
    const mp = await maps(s), cfg = await getCfg(s);
    const out = msgs.map(m => pubMsg(m, mp, me && me.id, owner));
    const sid = String(q.get("sid") || ""), online = await presence(s, /^[a-z0-9]{6,20}$/.test(sid) ? sid : "", me && me.id, ((await s.get("chat", { type: "json" })) || []).filter(m => Date.now() - m.t < 70000 && m.uid).map(m => m.uid));
    const r = { messages: out, slow: cfg.slow, pin: cfg.pin, online, me: me ? { id: me.id, name: me.name, color: mp.colors[me.id] || "", mutedUntil: mutes[me.id] ? (mutes[me.id].until || -1) : 0, banned: !!(mutes[me.id] && mutes[me.id].ban), mod: String(mp.badges[me.id] || "").split(",").includes("MOD"), pts: ptsInfo(mp.pts[me.id], etDay()) } : null, poll: pubPoll(await s.get("poll", { type: "json" }), me && me.id) };
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
  if (["delete", "mute", "unmute", "clear", "erase", "purge", "cfg", "pin", "unpin", "badge", "poll", "pollend", "pollclear", "spotlight"].includes(b.op)) {
    let isMod = false, actor = null, bmap0 = null;
    if (!owner && ["delete", "mute", "unmute", "pin", "unpin", "poll", "pollend", "pollclear"].includes(b.op)) {   // site moderators (accounts with the MOD badge)
      actor = await sessionUser(req, s); bmap0 = (await s.get("badges", { type: "json" })) || {};
      isMod = !!actor && String(bmap0[actor.id] || "").split(",").includes("MOD");
    }
    if (!owner && !isMod) return J({ error: "owner only" }, 403);
    if (isMod && b.op === "mute") {
      if (b.ban === true) return J({ error: "Only the owner can ban." }, 403);
      const tu = String(b.uid || "");
      if (tu === actor.id || String(bmap0[tu] || "").split(",").includes("MOD")) return J({ error: "You can't time out a moderator." }, 403);
      b.minutes = Math.max(1, Math.min(Number(b.minutes) || 10, 60));
    }
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
      if (b.op === "pin") { const text = String(b.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300); if (!text) return J({ error: "Type something to pin." }, 400); pin = { text, by: String(isMod && actor ? actor.name : (b.name || "")).slice(0, 20), t: Date.now() }; }
      await s.setJSON("cfg", { slow: cur.slow, words: cur.words, pin }); return J({ ok: true, pin });
    }
    if (b.op === "poll") {
      const q = String(b.q || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120), opts = (Array.isArray(b.opts) ? b.opts : []).map(x => String(x || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 5);
      if (!q || opts.length < 2) return J({ error: "A poll needs a question and at least 2 options." }, 400);
      const p = { id: Date.now().toString(36), q, opts, votes: {}, open: true, by: String(isMod && actor ? actor.name : "Ouri").slice(0, 20), t: Date.now() };
      await s.setJSON("poll", p); return J({ ok: true, poll: pubPoll(p, null) });
    }
    if (b.op === "pollend") { const p = await s.get("poll", { type: "json" }); if (!p) return J({ ok: true }); p.open = false; await s.setJSON("poll", p); return J({ ok: true, poll: pubPoll(p, null) }); }
    if (b.op === "pollclear") { await s.delete("poll"); return J({ ok: true }); }
    if (b.op === "spotlight") {
      const nm = String(b.name || "").trim().slice(0, 24); if (!nm) { await s.delete("spot"); return J({ ok: true, auto: true }); }
      const pt = (await s.get("points", { type: "json" })) || {}, hit = Object.values(pt).find(x => x.n && x.n.toLowerCase() === nm.toLowerCase());
      if (!hit) return J({ error: "No chat account with that name has points yet." }, 404);
      await s.setJSON("spot", { n: hit.n, note: String(b.note || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80), t: Date.now() }); return J({ ok: true, name: hit.n });
    }
    if (b.op === "badge") {
      const uid = String(b.uid || ""); if (!/^[a-f0-9]{16}$/.test(uid)) return J({ error: "uid" }, 400);
      const bd = (await s.get("badges", { type: "json" })) || {}, parts = String(b.badge || "").toUpperCase().split(",").map(x => x.trim()).filter(Boolean);
      if (parts.some(x => !BADGES.includes(x))) return J({ error: "badge" }, 400);
      const v = [...new Set(parts)].join(",");
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
    } else { const uid = String(b.uid || ""); if (isMod && mutes[uid] && mutes[uid].ban) return J({ error: "Only the owner can lift a ban." }, 403); await logMod(s, { uid, name: (mutes[uid] || {}).name || "", op: "lift" }); delete mutes[uid]; }
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
    if (col && !COLORS.includes(col)) { const lvC = lvOf((((await s.get("points", { type: "json" })) || {})[me.id] || {}).p || 0); if (!PREM.some(([pc, pl]) => pc === col && lvC >= pl)) return J({ error: "That color unlocks at a higher level." }, 400); }
    if (col) cs[me.id] = col; else delete cs[me.id]; await s.setJSON("colors", cs); return J({ ok: true, color: col });
  }
  if (b.op === "pollvote") {
    const p = await s.get("poll", { type: "json" }), i = Number(b.i);
    if (!p || !p.open) return J({ error: "That poll is closed." }, 400);
    if (!Number.isInteger(i) || i < 0 || i >= p.opts.length) return J({ error: "Bad option." }, 400);
    p.votes[me.id] = i; await s.setJSON("poll", p); return J({ ok: true, poll: pubPoll(p, me.id) });
  }
  if (b.op === "react") {
    const id = String(b.id || ""), em = String(b.emoji || ""); if (!/^[a-z0-9]{6,24}$/.test(id) || !EMOJI.includes(em)) return J({ error: "Bad request." }, 400);
    const rx = (await s.get("reacts", { type: "json" })) || {}, e = (rx[id] ||= {}), a = (e[em] ||= []), i = a.indexOf(me.id);
    if (i >= 0) a.splice(i, 1); else if (a.length < 300) a.push(me.id);
    if (!a.length) delete e[em]; if (!Object.keys(e).length) delete rx[id];
    const keys = Object.keys(rx); if (keys.length > 800) for (const k of keys.sort((x, y) => idTime(x) - idTime(y)).slice(0, keys.length - 800)) delete rx[k];
    await s.setJSON("reacts", rx); return J({ ok: true, rx: rxOf(rx, id, me.id) || {} });
  }
  if (["checkin", "link", "sync", "quest"].includes(b.op)) {
    const pt = (await s.get("points", { type: "json" })) || {}, r = recOf(pt, me), day = etDay();
    if (b.op === "checkin") {
      if (r.ci === day) return J({ error: "You already checked in today. Come back tomorrow!" }, 400);
      r.st = r.ci === etDay(86400000) ? (r.st || 0) + 1 : 1; r.ci = day;
      const gain = 25 + 5 * Math.min(r.st - 1, 6); addP(r, gain);
      await s.setJSON("points", pt); return J({ ok: true, gain, pts: ptsInfo(r, day) });
    }
    if (b.op === "link") {   // ties this browser's clip-voting id to the account so clip upvotes can earn points
      const vid = String(b.vid || ""); if (!/^[A-Za-z0-9_-]{4,60}$/.test(vid)) return J({ error: "vid" }, 400);
      const lk = (await s.get("links", { type: "json" })) || {};
      if (lk[vid] && lk[vid] !== me.id) return J({ ok: false }, 200);
      if (!r.vids.includes(vid) && r.vids.length < 3) { r.vids.push(vid); lk[vid] = me.id; await s.setJSON("links", lk); await s.setJSON("points", pt); }
      return J({ ok: true, pts: ptsInfo(r, day) });
    }
    if (b.op === "sync") {
      if (Date.now() - (r.sy || 0) < 20000) return J({ ok: true, gain: 0, pts: ptsInfo(r, day) });
      r.sy = Date.now(); const gain = await syncUps(r); await s.setJSON("points", pt); return J({ ok: true, gain, pts: ptsInfo(r, day) });
    }
    if (b.op === "quest") {
      if (!r.vids.length) return J({ ok: false }, 200);
      const db = getStore("ouri");
      if (b.q === "vote") {
        const id = String(b.id || ""); if (!/^[A-Za-z0-9_-]{1,60}$/.test(id) || r.q.v.includes(id) || r.q.v.length >= 3) return J({ ok: true, pts: ptsInfo(r, day) });
        const votes = (await db.get("votes", { type: "json" })) || {};
        if (r.vids.some(v => votes[v] && votes[v].v && votes[v].v[id])) r.q.v.push(id);
      } else if (b.q === "upload") {
        const clips = (await db.get("clips", { type: "json" })) || {};
        if (Object.values(clips).some(x => x && r.vids.includes(x.by) && etDay(Date.now() - x.created) === day)) r.q.u = 1;
      }
      const gain = questPay(r); await s.setJSON("points", pt); return J({ ok: true, gain, pts: ptsInfo(r, day) });
    }
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
  const pt = (await s.get("points", { type: "json" })) || {}, pr = recOf(pt, me), pday = etDay();
  if (pr.d !== pday) { pr.d = pday; pr.dp = 0; }
  if (Date.now() - (pr.t || 0) >= 20000 && pr.dp < 200) { addP(pr, 2); pr.dp += 2; pr.t = Date.now(); }
  pr.mc = (pr.mc || 0) + 1; bump(pr, 0, 1); pr.q.m++; questPay(pr); await s.setJSON("points", pt);
  let bot = null; const cm = /^!([a-z]{2,12})(?:\s|$)/i.exec(text);
  if (cm) { const reply = await botReply(cm[1].toLowerCase(), { me, pt, pr, req, s }); if (reply) { bot = { id: (Date.now() + 1).toString(36) + crypto.randomBytes(3).toString("hex"), uid: "bot", name: "OuriBot", text: reply, t: Date.now() + 1, badge: "BOT" }; const l2 = (await s.get("chat", { type: "json" })) || []; l2.push(bot); await s.setJSON("chat", l2.slice(-KEEP)); await archAdd(s, [bot]); } }
  const mp = { badges: (await s.get("badges", { type: "json" })) || {}, colors: (await s.get("colors", { type: "json" })) || {}, reacts: {}, pts: pt };
  return J({ ok: true, message: pubMsg(msg, mp, me.id, false), bot: bot ? pubMsg(bot, mp, me.id, false) : undefined });
};
