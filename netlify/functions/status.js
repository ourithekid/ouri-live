export const config = { path: "/api/status" };
const SLUG = "ouri";
let tok = null, tokExp = 0, cache = null, cacheAt = 0;

async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const r = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: (process.env.KICK_CLIENT_ID || '').trim(), client_secret: (process.env.KICK_CLIENT_SECRET || '').trim() })
  });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json(); tok = j.access_token; tokExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000; return tok;
}

const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
async function keyless() {
  const r = await fetch("https://kick.com/api/v2/channels/" + SLUG, { headers: UA });
  if (!r.ok) throw new Error("kick.com " + r.status);
  const c = await r.json(), ls = c.livestream || null;
  const cat = ls && ls.categories && ls.categories[0] && ls.categories[0].name || (c.recent_categories && c.recent_categories[0] && c.recent_categories[0].name) || null;
  return { ok: true, started: ls && (ls.start_time || ls.created_at) ? (Date.parse(String(ls.start_time || ls.created_at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(ls.start_time || ls.created_at)) ? "" : "Z")) || null) : null, live: !!(ls && (ls.is_live !== false)), viewers: ls ? (ls.viewer_count ?? ls.viewers ?? null) : null, category: cat, title: ls ? (ls.session_title || null) : null, followers: (c.followers_count ?? c.followersCount ?? null) };
}
export default async () => {
  const h = { "content-type": "application/json", "cache-control": "public, max-age=15" };
  if (cache && Date.now() - cacheAt < 15000) return new Response(JSON.stringify(cache), { headers: h });
  try {
    const r = await fetch("https://api.kick.com/public/v1/channels?slug=" + SLUG, { headers: { authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error("channels " + r.status);
    const c = ((await r.json()).data || [])[0] || {};
    const st = c.stream || {};
    cache = { ok: true, started: st.is_live && st.start_time ? (Date.parse(st.start_time) || null) : null, live: !!st.is_live, viewers: st.is_live ? (st.viewer_count ?? null) : null, category: (c.category && c.category.name) || null, title: c.stream_title || null, followers: (c.followers_count ?? c.followers ?? null) };
    cacheAt = Date.now();
    return new Response(JSON.stringify(cache), { headers: h });
  } catch (e) {
    try { cache = await keyless(); cacheAt = Date.now(); return new Response(JSON.stringify(cache), { headers: h }); } catch (e2) {}
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
