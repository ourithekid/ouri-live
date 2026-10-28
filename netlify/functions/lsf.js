export const config = { path: "/api/lsf" };
let cache = null, at = 0;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
const Q = "limit=60&raw_json=1";
const SOURCES = [
  { u: "https://www.reddit.com/r/LivestreamFail/search.json?q=flair_name%3A%22Kick%22&restrict_sr=on&sort=new&t=month&" + Q, strict: false },
  { u: "https://old.reddit.com/r/LivestreamFail/search.json?q=flair_name%3A%22Kick%22&restrict_sr=on&sort=new&t=month&" + Q, strict: false },
  { u: "https://www.reddit.com/r/LivestreamFail/new.json?limit=100&raw_json=1", strict: true },
  { u: "https://old.reddit.com/r/LivestreamFail/new.json?limit=100&raw_json=1", strict: true },
];
const isKick = d => /kick/i.test(d.link_flair_text || "") || /kick\.com/i.test(d.domain || d.url || "") || /\bkick\b/i.test(d.title || "");
const shape = d => {
  const pv = d.preview && d.preview.images && d.preview.images[0];
  const thumb = pv ? ((pv.resolutions || []).slice(-3)[0] || pv.source).url : (/^https?:/.test(d.thumbnail || "") ? d.thumbnail : null);
  const rv = (d.media && d.media.reddit_video) || (d.secure_media && d.secure_media.reddit_video);
  const play = rv ? (rv.hls_url || rv.fallback_url) : (d.url_overridden_by_dest || d.url);
  return { id: d.id, title: String(d.title || "").slice(0, 160), thumb, play, link: "https://www.reddit.com" + d.permalink, domain: d.domain || "", flair: d.link_flair_text || "", score: d.score || 0, created: (d.created_utc || 0) * 1000 };
};
export default async (req) => {
  const debug = new URL(req.url).searchParams.get("debug");
  if (!debug && cache && Date.now() - at < 600000) return J(cache);
  const tried = [];
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.u, { headers: { "user-agent": UA, accept: "application/json" } });
      tried.push({ u: s.u.slice(0, 60), status: r.status });
      if (!r.ok) continue;
      const j = await r.json();
      let posts = ((j.data && j.data.children) || []).map(c => c.data).filter(d => d && !d.over_18 && !d.stickied);
      if (s.strict) posts = posts.filter(isKick);
      const items = posts.map(shape).filter(x => x.thumb || x.play).slice(0, 30);
      if (items.length) { cache = { ok: true, items }; at = Date.now(); return J(debug ? { ...cache, tried } : cache); }
    } catch (e) { tried.push({ u: s.u.slice(0, 60), error: String(e.message || e) }); }
  }
  return J(cache || { ok: false, tried }, cache ? 200 : 502);
};
