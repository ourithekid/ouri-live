export const config = { path: "/api/twitch-streams" };

// English-language IRL streams that are live on Twitch right now (the Twitch twin of /api/irl).
// If TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set in Netlify, it uses Twitch's official API.
// Otherwise it falls back to the same public endpoint twitch.tv itself uses. Cached for 60 seconds.
let cache = null, at = 0, tok = null, tokExp = 0;
const H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" };
const clean = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);
const login = s => (/^[A-Za-z0-9_]{2,25}$/.test(String(s || "")) ? String(s).toLowerCase() : "");
async function get(u, opt = {}, ms = 7000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(u, { ...opt, signal: c.signal }); } finally { clearTimeout(t); } }

async function viaHelix() {
  const id = (process.env.TWITCH_CLIENT_ID || "").trim(), sec = (process.env.TWITCH_CLIENT_SECRET || "").trim();
  if (!id || !sec) return null;
  if (!tok || Date.now() > tokExp) {
    const r = await get("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: sec, grant_type: "client_credentials" }) });
    if (!r.ok) return null;
    const j = await r.json(); tok = j.access_token; tokExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000;
  }
  const A = { authorization: "Bearer " + tok, "client-id": id };
  const g = await get("https://api.twitch.tv/helix/games?name=IRL", { headers: A });
  const gj = g.ok ? await g.json() : {};
  const gid = gj.data && gj.data[0] && gj.data[0].id; if (!gid) return null;
  const r = await get("https://api.twitch.tv/helix/streams?first=30&language=en&game_id=" + encodeURIComponent(gid), { headers: A });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.data || []).map(s => ({ login: login(s.user_login), name: clean(s.user_name, 40), title: clean(s.title, 120), viewers: Number(s.viewer_count) || 0 }));
}

async function viaGql() {
  const q = 'query{game(name:"IRL"){streams(first:30,options:{sort:VIEWER_COUNT,broadcasterLanguages:[EN]}){edges{node{title viewersCount broadcaster{login displayName}}}}}}';
  const r = await get("https://gql.twitch.tv/gql", { method: "POST", headers: { "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
  if (!r.ok) return null;
  const j = await r.json();
  const edges = j && j.data && j.data.game && j.data.game.streams && j.data.game.streams.edges;
  if (!Array.isArray(edges)) return null;
  return edges.map(e => e.node).filter(Boolean).map(n => ({ login: login(n.broadcaster && n.broadcaster.login), name: clean(n.broadcaster && n.broadcaster.displayName, 40), title: clean(n.title, 120), viewers: Number(n.viewersCount) || 0 }));
}

async function why() {
  const out = {};
  try { const id = (process.env.TWITCH_CLIENT_ID || "").trim(), sec = (process.env.TWITCH_CLIENT_SECRET || "").trim(); out.helix_keys = id && sec ? "both set" : (id ? "secret MISSING" : "id MISSING");
    if (id && sec) { const r = await get("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: id, client_secret: sec, grant_type: "client_credentials" }) }); out.helix_token = r.status + " " + (await r.text()).slice(0, 100); } } catch (e) { out.helix_token = "ERR " + e.message; }
  try { const q = 'query{game(name:"IRL"){streams(first:3,options:{sort:VIEWER_COUNT,broadcasterLanguages:[EN]}){edges{node{title}}}}}'; const r = await get("https://gql.twitch.tv/gql", { method: "POST", headers: { "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko", "content-type": "application/json" }, body: JSON.stringify({ query: q }) }); out.gql = r.status + " " + (await r.text()).slice(0, 200); } catch (e) { out.gql = "ERR " + e.message; }
  return out;
}
export default async (req) => {
  if (req && /[?&]debug/.test(req.url)) return new Response(JSON.stringify(await why(), null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (cache && Date.now() - at < 60000) return new Response(JSON.stringify(cache), { headers: H });
  let list = null;
  try { list = await viaHelix(); } catch {}
  if (!list || !list.length) { try { list = await viaGql(); } catch {} }
  if (list && list.length) {
    cache = { ok: true, streams: list.filter(s => s.login).sort((a, b) => b.viewers - a.viewers).slice(0, 20) };
    at = Date.now();
    return new Response(JSON.stringify(cache), { headers: H });
  }
  if (cache) return new Response(JSON.stringify(cache), { headers: H });
  return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
};
