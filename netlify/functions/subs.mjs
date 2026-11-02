import { getStore } from "@netlify/blobs";
export const config = { path: "/api/subs" };
// Ouri's true ACTIVE subscriber count, straight from Kick's official API (channels -> active_subscribers_count).
// Used by the OBS sub counter overlay. Public + read-only: it only returns two numbers.
const SLUG = "ouri";
const H = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const env = k => (process.env[k] || "").trim();
let cache = null, cacheAt = 0, appTok = null, appExp = 0;

async function appToken() {
  if (appTok && Date.now() < appExp) return appTok;
  const r = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("KICK_CLIENT_ID"), client_secret: env("KICK_CLIENT_SECRET") }) });
  if (!r.ok) throw new Error("app token " + r.status);
  const j = await r.json(); appTok = j.access_token; appExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000; return appTok;
}
// owner token (from /api/kick-auth). Refreshed automatically when it expires.
async function ownerToken(force) {
  const s = getStore({ name: "ouri-private", consistency: "strong" }), a = await s.get("auth", { type: "json" });
  if (!a || !a.access) return null;
  if (!force && a.at && Date.now() - a.at < 3000 * 1000) return a.access;
  if (!a.refresh) return a.access;
  const r = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", client_id: env("KICK_CLIENT_ID"), client_secret: env("KICK_CLIENT_SECRET"), refresh_token: a.refresh }) });
  if (!r.ok) return a.access;
  const j = await r.json().catch(() => ({})); if (!j.access_token) return a.access;
  await s.setJSON("auth", { access: j.access_token, refresh: j.refresh_token || a.refresh, at: Date.now() });
  return j.access_token;
}
const pick = (j) => { const c = ((j && j.data) || [])[0] || null; if (!c) return null; const n = c.active_subscribers_count; return Number.isFinite(Number(n)) && n !== null ? { subs: Number(n), canceled: Number(c.canceled_subscribers_count) || 0, keys: Object.keys(c) } : { keys: Object.keys(c) }; };
async function get(tok, withSlug) {
  const r = await fetch("https://api.kick.com/public/v1/channels" + (withSlug ? "?slug=" + SLUG : ""), { headers: { authorization: "Bearer " + tok } });
  return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
}
async function load() {
  const tried = [];
  // 1) owner token (always allowed to see its own channel's subscriber numbers)
  try {
    let t = await ownerToken(false);
    if (t) { let r = await get(t, false); if (r.status === 401) { t = await ownerToken(true); r = await get(t, false); } tried.push("owner:" + r.status); const p = pick(r.body); if (p && p.subs != null) return p; }
  } catch (e) { tried.push("owner:err"); }
  // 2) app token
  try { const r = await get(await appToken(), true); tried.push("app:" + r.status); const p = pick(r.body); if (p && p.subs != null) return p; } catch (e) { tried.push("app:err"); }
  const err = new Error("not available"); err.tried = tried; throw err;
}
export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...H, "access-control-allow-methods": "GET", "access-control-allow-headers": "*" } });
  if (cache && Date.now() - cacheAt < 15000) return J(cache);
  try { const p = await load(); cache = { ok: true, subs: p.subs, canceled: p.canceled, at: Date.now() }; cacheAt = Date.now(); return J(cache); }
  catch (e) { return J({ ok: false, error: "Kick did not return a subscriber count. Reconnect Kick at /api/kick-auth?key=YOUR_OWNER_KEY and try again.", tried: e.tried || [] }, 502); }
};
