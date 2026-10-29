import { getStore } from "@netlify/blobs";
export const config = { path: "/api/kick-clips" };

// Latest clips from kick.com/ouri. Kick has no official clips API yet, so this asks the same public
// endpoint the Kick website uses, remembers the last good answer, and serves that if Kick is busy or blocks us.
const SLUG = "ouri", FRESH = 10 * 60 * 1000, KEEP = 12;
const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=120" } });
const https = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
const clean = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);

async function live() {
  const urls = [
    "https://kick.com/api/v2/channels/" + SLUG + "/clips?cursor=0&sort=date&time=all",
    "https://kick.com/api/v2/channels/" + SLUG + "/clips?sort=date",
  ];
  for (const u of urls) {
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(u, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", referer: "https://kick.com/" + SLUG } });
      clearTimeout(tm);
      if (!r.ok) continue;
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j.clips || j.data || []);
      const out = [];
      for (const c of arr) {
        const id = clean(c.id || c.clip_id, 60);
        if (!/^[A-Za-z0-9_-]{4,60}$/.test(id)) continue;
        out.push({
          id,
          title: clean(c.title, 90) || "Kick clip",
          url: https(c.clip_url) || "https://kick.com/" + SLUG + "/clips/" + id,
          thumb: https(c.thumbnail_url || c.thumbnail || ""),
          created: Date.parse(c.created_at || c.createdAt || "") || 0,
          views: Number(c.view_count || c.views || 0) || 0,
          by: clean((c.creator && (c.creator.username || c.creator.slug)) || "", 40),
        });
      }
      if (out.length) return out.sort((a, b) => b.created - a.created).slice(0, KEEP);
    } catch {}
  }
  return null;
}

export default async () => {
  const s = st();
  let cache = null; try { cache = await s.get("kickclips", { type: "json" }); } catch {}
  if (cache && cache.clips && Date.now() - (cache.t || 0) < FRESH) return J({ ok: true, clips: cache.clips });
  const fresh = await live();
  if (fresh) { try { await s.setJSON("kickclips", { t: Date.now(), clips: fresh }); } catch {} return J({ ok: true, clips: fresh }); }
  if (cache && cache.clips) return J({ ok: true, stale: true, clips: cache.clips });
  return J({ ok: false, clips: [] });
};
