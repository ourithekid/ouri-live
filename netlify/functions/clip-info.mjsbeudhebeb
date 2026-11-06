import { getStore } from "@netlify/blobs";
export const config = { path: "/api/clip-info" };

// Title + thumbnail for one Kick clip, used by the clip preview cards in site chat.
// Asks the same public endpoint kick.com uses, remembers the answer, and degrades to "no thumbnail" if Kick says no.
const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
const https = u => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
const clean = (s, n) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, n);
const OK_TTL = 7 * 86400000, BAD_TTL = 10 * 60000;

async function lookup(id) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch("https://kick.com/api/v2/clips/" + id, { signal: ctl.signal, headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", referer: "https://kick.com/" } });
    if (!r.ok) return null;
    const j = await r.json(), c = j.clip || j.data || j;
    if (!c || typeof c !== "object") return null;
    const ch = c.channel || {};
    return {
      title: clean(c.title, 90) || "Kick clip",
      thumb: https(c.thumbnail_url || c.thumbnail || ""),
      channel: clean(ch.slug || ch.username || "", 40),
      by: clean((c.creator && (c.creator.username || c.creator.slug)) || "", 40),
      views: Number(c.view_count || c.views || 0) || 0,
      dur: Number(c.duration || 0) || 0,
    };
  } catch { return null; } finally { clearTimeout(tm); }
}

export default async (req) => {
  const id = String(new URL(req.url).searchParams.get("id") || "");
  if (!/^clip_[A-Za-z0-9]{6,40}$/.test(id)) return J({ ok: false }, 400);
  const s = st(), key = "clipinfo/" + id;
  let c = null; try { c = await s.get(key, { type: "json" }); } catch {}
  if (c && Date.now() - c.t < (c.info ? OK_TTL : BAD_TTL)) return J(c.info ? { ok: true, ...c.info } : { ok: false });
  const info = await lookup(id);
  try { await s.setJSON(key, { t: Date.now(), info }); } catch {}
  return J(info ? { ok: true, ...info } : { ok: false });
};
