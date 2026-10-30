export const config = { path: "/api/thumb" };
// Finds a preview picture for a clip link (the page's og:image). Only a short list of video sites is allowed. Cached for hours.
const OK_HOSTS = /(^|\.)(kick\.com|twitch\.tv|x\.com|twitter\.com|streamable\.com|youtube\.com|youtu\.be|reddit\.com|redd\.it|tiktok\.com|instagram\.com|medal\.tv|clippi\.in|vimeo\.com|dailymotion\.com|facebook\.com|fb\.watch|imgur\.com)$/i;
const cache = new Map();
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
const decode = s => String(s).replace(/&amp;/g, "&").replace(/&#x2F;/g, "/").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
export default async (req) => {
  const u = new URL(req.url).searchParams.get("u") || "";
  let t; try { t = new URL(u); } catch { return J({ ok: false }, 400); }
  if (t.protocol !== "https:" || !OK_HOSTS.test(t.hostname)) return J({ ok: false }, 400);
  const key = t.href, c = cache.get(key); if (c && Date.now() < c.exp) return J({ ok: !!c.img, img: c.img || "" });
  let img = "";
  try {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(t.href, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": "Twitterbot/1.0", accept: "text/html" } }); clearTimeout(tm);
    if (r.url && !OK_HOSTS.test(new URL(r.url).hostname)) throw new Error("redirect");
    const html = (await r.text()).slice(0, 400000);
    const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    if (m) { const abs = new URL(decode(m[1]), r.url || t.href); if (abs.protocol === "https:") img = abs.href; }
  } catch (e) {}
  cache.set(key, { img, exp: Date.now() + (img ? 6 * 3600000 : 1800000) }); if (cache.size > 800) cache.delete(cache.keys().next().value);
  return J({ ok: !!img, img });
};
