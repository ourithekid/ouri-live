export const config = { path: "/api/twitch" };
// Live Twitch follower count for twitch.tv/ouri. Cached for 60s so the site never hammers the source.
const CH = "ouri";
let cache = null, at = 0;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
const num = t => { const n = parseInt(String(t).replace(/[^\d]/g, ""), 10); return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null; };
async function get(u, ms = 6000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(u, { signal: c.signal, headers: { "user-agent": "ouri-live-site/1.0" } }); } finally { clearTimeout(t); } }
export default async () => {
  if (cache && Date.now() - at < 60000) return J(cache);
  const sources = [
    async () => { const r = await fetch("https://gql.twitch.tv/gql", { method: "POST", headers: { "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "content-type": "application/json" }, body: JSON.stringify({ query: 'query{user(login:"' + CH + '"){followers{totalCount}}}' }) }); if (!r.ok) return null; const j = await r.json(); const n = j && j.data && j.data.user && j.data.user.followers && j.data.user.followers.totalCount; return Number.isFinite(n) ? n : null; },
    async () => { const r = await get("https://decapi.me/twitch/followcount/" + CH); return r.ok ? num(await r.text()) : null; },
    async () => { const r = await get("https://decapi.me/twitch/followcount/" + CH + "?v=2"); return r.ok ? num(await r.text()) : null; }
  ];
  for (const s of sources) { try { const n = await s(); if (n != null) { cache = { ok: true, followers: n }; at = Date.now(); return J(cache); } } catch (e) {} }
  return J(cache || { ok: false }, cache ? 200 : 502);
};
