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

const findFol = (o, d = 0) => { if (!o || typeof o !== "object" || d > 3) return null; for (const k of Object.keys(o)) { const v = o[k]; if (/follow/i.test(k) && /count|num|total/i.test(k) && Number.isFinite(Number(v)) && v !== null && v !== "" && typeof v !== "boolean") return Number(v); } for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") { const r = findFol(v, d + 1); if (r != null) return r; } } return null; };
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
async function keyless() {
  const r = await fetch("https://kick.com/api/v2/channels/" + SLUG, { headers: UA });
  if (!r.ok) throw new Error("kick.com " + r.status);
  const c = await r.json(), ls = c.livestream || null;
  const cat = ls && ls.categories && ls.categories[0] && ls.categories[0].name || (c.recent_categories && c.recent_categories[0] && c.recent_categories[0].name) || null;
  return { ok: true, started: ls && (ls.start_time || ls.created_at) ? (Date.parse(String(ls.start_time || ls.created_at).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(ls.start_time || ls.created_at)) ? "" : "Z")) || null) : null, live: !!(ls && (ls.is_live !== false)), viewers: ls ? (ls.viewer_count ?? ls.viewers ?? null) : null, category: cat, title: ls ? (ls.session_title || null) : null, followers: (c.followers_count ?? c.followersCount ?? findFol(c)) };
}
let lastFol = null;
// follower count from Kick's public channel pages (the official API does not include it)
async function followers() {
  for (const u of ["https://kick.com/api/v2/channels/" + SLUG, "https://kick.com/api/v1/channels/" + SLUG, "https://kick.com/api/v2/channels/" + SLUG + "/info"]) {
    try {
      const r = await fetch(u, { headers: UA }); if (!r.ok) continue;
      const c = await r.json(), n = c.followers_count ?? c.followersCount ?? (c.user && c.user.followers_count) ?? findFol(c);
      if (n != null && !isNaN(n)) return Number(n);
    } catch {}
  }
  return null;
}
export default async (req) => {
  if (req && new URL(req.url).searchParams.get("debug")) {
    const out = {};
    for (const u of ["https://kick.com/api/v2/channels/" + SLUG, "https://kick.com/api/v1/channels/" + SLUG]) {
      try { const r = await fetch(u, { headers: UA }); out[u] = { status: r.status }; if (r.ok) { const c = await r.json(); out[u].follow_fields = Object.keys(c).filter(k => /follow/i.test(k)).map(k => k + "=" + JSON.stringify(c[k]).slice(0, 40)); out[u].found = findFol(c); } else out[u].body = (await r.text()).slice(0, 120); } catch (e) { out[u] = { error: String(e.message || e) }; }
    }
    return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  const h = { "content-type": "application/json", "cache-control": "public, max-age=15" };
  if (cache && Date.now() - cacheAt < 15000) return new Response(JSON.stringify(cache), { headers: h });
  try {
    const r = await fetch("https://api.kick.com/public/v1/channels?slug=" + SLUG, { headers: { authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error("channels " + r.status);
    const c = ((await r.json()).data || [])[0] || {};
    const st = c.stream || {};
    cache = { ok: true, started: st.is_live && st.start_time ? (Date.parse(st.start_time) || null) : null, live: !!st.is_live, viewers: st.is_live ? (st.viewer_count ?? null) : null, category: (c.category && c.category.name) || null, title: c.stream_title || null, followers: (c.followers_count ?? c.followers ?? null) };
    if (cache.followers == null) { try { cache.followers = await followers(); } catch {} }
    if (cache.followers != null) lastFol = cache.followers; else if (lastFol != null) cache.followers = lastFol;
    cacheAt = Date.now();
    return new Response(JSON.stringify(cache), { headers: h });
  } catch (e) {
    try { cache = await keyless(); if (cache.followers == null) { try { cache.followers = await followers(); } catch {} } if (cache.followers != null) lastFol = cache.followers; else if (lastFol != null) cache.followers = lastFol; cacheAt = Date.now(); return new Response(JSON.stringify(cache), { headers: h }); } catch (e2) {}
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
