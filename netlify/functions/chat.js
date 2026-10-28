import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/chat" };
// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const hits = new Map();
const limited = (req, key, max, ms) => { const ip = String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };


const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const KEEP = 300, SHOW = 80, GAP = 2000;

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
    const me = await sessionUser(req, s);
    const mutes = activeMutes(await s.get("mutes", { type: "json" }));
    const msgs = ((await s.get("chat", { type: "json" })) || []).slice(-SHOW);
    const out = msgs.map(m => owner ? m : { id: m.id, name: m.name, text: m.text, t: m.t, badge: m.badge });
    const r = { messages: out, me: me ? { id: me.id, name: me.name, mutedUntil: mutes[me.id] ? (mutes[me.id].until || -1) : 0 } : null };
    if (owner) r.mutes = Object.entries(mutes).map(([uid, v]) => ({ uid, name: v.name, until: v.until || 0 }));
    return J(r);
  }
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text(); if (raw.length > 4000) return J({ error: "Too big." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400);

  // ---- moderation (owner key required) ----
  if (b.op === "delete" || b.op === "mute" || b.op === "unmute") {
    if (!owner) return J({ error: "owner only" }, 403);
    if (b.op === "delete") {
      const list = (await s.get("chat", { type: "json" })) || [];
      await s.setJSON("chat", list.filter(m => m.id !== String(b.id))); return J({ ok: true });
    }
    const mutes = (await s.get("mutes", { type: "json" })) || {};
    if (b.op === "mute") {
      const uid = String(b.uid || ""); if (!/^[a-f0-9]{16}$/.test(uid)) return J({ error: "uid" }, 400);
      const mins = Math.max(0, Math.min(Number(b.minutes) || 0, 525600));
      mutes[uid] = { name: String(b.name || "").slice(0, 20), until: mins ? Date.now() + mins * 60000 : 0, t: Date.now() };
    } else delete mutes[String(b.uid || "")];
    await s.setJSON("mutes", activeMutes(mutes)); return J({ ok: true });
  }

  // ---- posting (account required) ----
  if (limited(req, "chat", 40, 60000)) return J({ error: "Slow down a little." }, 429);
  const me = await sessionUser(req, s);
  if (!me) return J({ error: "Log in to chat." }, 401);
  const mutes = activeMutes(await s.get("mutes", { type: "json" }));
  if (mutes[me.id]) return J({ error: "You’ve been muted by the moderator.", muted: true }, 403);
  const last = (await s.get("last/" + me.id, { type: "json" })) || { t: 0 };
  if (Date.now() - last.t < GAP) return J({ error: "Slow down a little." }, 429);
  const text = String(b.text || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return J({ error: "Type a message first." }, 400);
  await s.setJSON("last/" + me.id, { t: Date.now() });
  const msg = { id: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), uid: me.id, name: me.name, text, t: Date.now(), badge: owner ? "OWNER" : "" };
  const list = (await s.get("chat", { type: "json" })) || [];
  list.push(msg); await s.setJSON("chat", list.slice(-KEEP));
  return J({ ok: true, message: { id: msg.id, name: msg.name, text: msg.text, t: msg.t, badge: msg.badge } });
};
