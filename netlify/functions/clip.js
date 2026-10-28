export const config = { path: "/api/clip" };
const cache = new Map();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export default async (req) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^clip_[A-Za-z0-9]{8,40}$/.test(id)) return J({ ok: false, error: "bad id" }, 400);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.t < 600000) return J(hit.v);
  try {
    const r = await fetch("https://kick.com/api/v2/clips/" + id, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", referer: "https://kick.com/" } });
    if (!r.ok) return J({ ok: false, error: "kick " + r.status }, 502);
    const j = await r.json(); const c = j.clip || j;
    const mp4 = c.clip_url && /\.mp4(\?|$)/.test(c.clip_url) ? c.clip_url : null;
    const hls = c.video_url && /\.m3u8(\?|$)/.test(c.video_url) ? c.video_url : (c.clip_url && /\.m3u8/.test(c.clip_url) ? c.clip_url : null);
    if (!mp4 && !hls) return J({ ok: false, error: "no video in response" }, 502);
    const v = { ok: true, mp4, hls, thumb: c.thumbnail_url || null, title: c.title || null };
    cache.set(id, { t: Date.now(), v }); return J(v);
  } catch (e) { return J({ ok: false, error: String(e.message || e) }, 502); }
};
