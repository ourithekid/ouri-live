export const config = { path: "/api/yt-subs" };
const HANDLE = "OuriTheKid";
let cache = null, at = 0;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
const parse = t => { const m = String(t).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i); if (!m) return null; const k = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1; return Math.round(parseFloat(m[1]) * k); };
export default async () => {
  if (cache && Date.now() - at < 60000) return J(cache);
  const key = process.env.YT_API_KEY;
  try {
    if (key) {
      const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=statistics&forHandle=" + HANDLE + "&key=" + key);
      const j = await r.json(); const s = j.items && j.items[0] && j.items[0].statistics;
      if (s && !s.hiddenSubscriberCount) { cache = { ok: true, subs: Number(s.subscriberCount) }; at = Date.now(); return J(cache); }
    }
  } catch (e) {}
  try {
    const r = await fetch("https://www.youtube.com/@" + HANDLE + "/about", { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1; SOCS=CAI" } });
    const x = await r.text();
    const m = x.match(/"subscriberCountText":\{[^}]*?"simpleText":"([^"]+?) subscribers?"/) || x.match(/"content":"([\d.,]+[KMB]?) subscribers?"/) || x.match(/([\d.,]+[KMB]?) subscribers/);
    const n = m && parse(m[1]);
    if (n != null) { cache = { ok: true, subs: n }; at = Date.now(); return J(cache); }
  } catch (e) {}
  return J(cache || { ok: false }, cache ? 200 : 502);
};
