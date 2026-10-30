import { getStore } from "@netlify/blobs";
export const config = { path: "/api/kick-weekly" };

// Kick weekly top clips: (1) the most-watched clip from kick.com/ouri this week, (2) the most-watched clip on Kick
// from any other streamer this week. Uses the same public endpoints the Kick website uses, remembers the last good
// answer, and serves that if Kick is busy or blocks us.
const SLUG = "ouri", FRESH = 30 * 60 * 1000;
const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
const https = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
const clean = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);
const HDR = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

async function get(u) {
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(u, { signal: ctl.signal, headers: HDR }); clearTimeout(tm);
    if (!r.ok) return null; return await r.json();
  } catch { return null; }
}
function norm(c, fallbackSlug) {
  const id = clean(c.id || c.clip_id, 60); if (!/^[A-Za-z0-9_-]{4,60}$/.test(id)) return null;
  const ch = c.channel || {}, slug = clean(ch.slug || ch.username || fallbackSlug || "", 40).toLowerCase().replace(/_/g, "-"), name = clean(ch.username || ch.slug || fallbackSlug || "", 40);
  if (!slug) return null;
  return {
    id, title: clean(c.title, 90) || "Kick clip",
    url: https(c.clip_url) || "https://kick.com/" + slug + "/clips/" + id,
    thumb: https(c.thumbnail_url || c.thumbnail || ""),
    views: Number(c.view_count || c.views || 0) || 0,
    created: Date.parse(c.created_at || c.createdAt || "") || 0,
    streamer: name || slug, slug,
  };
}
const list = j => Array.isArray(j) ? j : ((j && (j.clips || j.data)) || []);
const best = a => a.filter(Boolean).sort((x, y) => y.views - x.views)[0] || null;

async function live() {
  const week = Date.now() - 7 * 86400000;
  const [o1, o2, t1, t2] = await Promise.all([
    get("https://kick.com/api/v2/channels/" + SLUG + "/clips?cursor=0&sort=view&time=week"),
    get("https://kick.com/api/v2/channels/" + SLUG + "/clips?sort=view&time=week"),
    get("https://kick.com/api/v2/clips?cursor=0&sort=view&time=week"),
    get("https://kick.com/api/v2/clips?sort=view&time=week"),
  ]);
  let mine = best(list(o1 || o2).map(c => norm(c, SLUG)).filter(c => c && (!c.created || c.created >= week)));
  if (mine) { mine.streamer = "Ouri"; mine.slug = SLUG; }
  const top = best(list(t1 || t2).map(c => norm(c)).filter(c => c && c.slug !== SLUG && (!c.created || c.created >= week)));
  return (mine || top) ? { mine, top } : null;
}

export default async () => {
  const s = st();
  let cache = null; try { cache = await s.get("kickweekly", { type: "json" }); } catch {}
  if (cache && Date.now() - (cache.t || 0) < FRESH) return J({ ok: true, mine: cache.mine, top: cache.top });
  const fresh = await live();
  if (fresh) { try { await s.setJSON("kickweekly", { t: Date.now(), ...fresh }); } catch {} return J({ ok: true, ...fresh }); }
  if (cache) return J({ ok: true, stale: true, mine: cache.mine, top: cache.top });
  return J({ ok: false });
};
