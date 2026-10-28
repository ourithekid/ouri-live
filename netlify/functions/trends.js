export const config = { path: "/api/trends" };
let cache = null, at = 0;
const dec = s => String(s).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
export default async () => {
  const h = { "content-type": "application/json", "cache-control": "public, max-age=300" };
  if (cache && Date.now() - at < 600000) return new Response(JSON.stringify(cache), { headers: h });
  const urls = ["https://trends.google.com/trending/rss?geo=US", "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US"];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (compatible; OuriSite/1.0)" } });
      if (!r.ok) continue;
      const x = await r.text();
      const topics = [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
        const b = m[1];
        const t = (b.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
        const tr = (b.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/) || [])[1];
        const nt = (b.match(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/) || [])[1];
        const ns = (b.match(/<ht:news_item_source>([\s\S]*?)<\/ht:news_item_source>/) || [])[1];
        return t ? { topic: dec(t).slice(0, 80), traffic: tr ? dec(tr).slice(0, 12) : "", why: nt ? dec(nt).replace(/<[^>]*>/g, "").slice(0, 150) : "", src: ns ? dec(ns).slice(0, 40) : "" } : null;
      }).filter(Boolean).slice(0, 12);
      if (topics.length) { cache = { ok: true, topics }; at = Date.now(); return new Response(JSON.stringify(cache), { headers: h }); }
    } catch (e) {}
  }
  return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
};
