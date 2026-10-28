export const config = { path: "/api/irl" };
let tok = null, tokExp = 0, cache = null, cacheAt = 0;
async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const r = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: (process.env.KICK_CLIENT_ID || '').trim(), client_secret: (process.env.KICK_CLIENT_SECRET || '').trim() }) });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json(); tok = j.access_token; tokExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000; return tok;
}
export default async () => {
  const h = { "content-type": "application/json", "cache-control": "public, max-age=60" };
  if (cache && Date.now() - cacheAt < 60000) return new Response(JSON.stringify(cache), { headers: h });
  try {
    const r = await fetch("https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count", { headers: { authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error("livestreams " + r.status);
    const list = ((await r.json()).data || []).filter(s => /irl/i.test((s.category && s.category.name) || ""));
    cache = { ok: true, streams: list.slice(0, 24).map(s => ({ slug: s.slug, title: s.stream_title, viewers: s.viewer_count })) };
    cacheAt = Date.now();
    return new Response(JSON.stringify(cache), { headers: h });
  } catch (e) { return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } }); }
};
