export const config = { path: "/api/emotes" };
// Public global emote lists from BetterTTV and 7TV, fetched here so the browser makes one request. Cached for an hour.
let cache = null, at = 0;
const J = o => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
async function get(u) { const c = new AbortController(), t = setTimeout(() => c.abort(), 6000); try { const r = await fetch(u, { signal: c.signal, headers: { "user-agent": "ouri-live-site/1.0" } }); return await r.json(); } finally { clearTimeout(t); } }
const okName = n => /^[A-Za-z0-9_]{2,25}$/.test(n);
export default async () => {
  if (cache && Date.now() - at < 3600000) return J(cache);
  const out = { bttv: [], seventv: [] };
  try { const j = await get("https://api.betterttv.net/3/cached/emotes/global"); out.bttv = (Array.isArray(j) ? j : []).filter(e => e && okName(e.code) && /^[a-f0-9]{24}$/.test(e.id)).slice(0, 120).map(e => [e.code, e.id]); } catch (e) {}
  try { const j = await get("https://7tv.io/v3/emote-sets/global"); out.seventv = ((j && j.emotes) || []).filter(e => e && okName(e.name) && /^[A-Za-z0-9]{10,40}$/.test(e.id)).slice(0, 160).map(e => [e.name, e.id]); } catch (e) {}
  if (out.bttv.length || out.seventv.length) { cache = out; at = Date.now(); }
  return J(cache || out);
};
