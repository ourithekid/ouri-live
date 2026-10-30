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
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
