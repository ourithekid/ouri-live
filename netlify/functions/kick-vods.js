// Past broadcasts straight from Kick (nothing is stored on the site).
export const config = { path: "/api/kick-vods" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
let cache = { at: 0, vods: null };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
async function get(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": UA, referer: "https://kick.com/ouri" } });
    if (!r.ok) throw new Error("http " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function norm(o) {
  if (!o || typeof o !== "object") return null;
  const v = o.video || {}, ls = o.livestream || {};
  const uuid = v.uuid || o.uuid;
  if (!uuid || !/^[0-9a-f-]{20,}$/i.test(String(uuid))) return null;
  const th = o.thumbnail || ls.thumbnail || v.thumb || "";
  const thumb = typeof th === "string" ? th : (th.src || "");
  let dur = Number(o.duration || ls.duration || 0);
  if (dur && dur < 100000) dur *= 1000; // seconds -> ms when needed
  const when = o.start_time || o.created_at || ls.start_time || ls.created_at || v.created_at || "";
  return {
    id: String(uuid),
    title: String(o.session_title || o.title || ls.session_title || "Stream").slice(0, 140),
    url: "https://kick.com/ouri/videos/" + uuid,
    thumb: /^https:\/\//.test(thumb) ? thumb : "",
    dur: dur || 0,
    date: when ? String(when) : "",
    views: Number(v.views || o.views || ls.views || 0) || 0,
  };
}
async function load() {
  const tries = ["https://kick.com/api/v2/channels/ouri/videos", "https://kick.com/api/v2/channels/ouri"];
  let lastErr = null;
  for (const u of tries) {
    try {
      const j = await get(u);
      const arr = Array.isArray(j) ? j : (j.previous_livestreams || j.videos || j.data || []);
      const out = arr.map(norm).filter(Boolean);
      if (out.length) return out;
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return [];
}
export default async (req) => {
  if (cache.vods && Date.now() - cache.at < 300000) return J({ ok: true, vods: cache.vods });
  try {
    const v = (await load()).slice(0, 60);
    cache = { at: Date.now(), vods: v };
    return J({ ok: true, vods: v });
  } catch (e) {
    if (cache.vods) return J({ ok: true, vods: cache.vods });
    return J({ ok: false, error: "kick unavailable" }, 502);
  }
};
