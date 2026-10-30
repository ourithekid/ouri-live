export const config = { path: "/api/irl" };
let tok = null, tokExp = 0, cache = null, cacheAt = 0;
async function token() {
  if (tok && Date.now() < tokExp) return tok;
  const r = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: (process.env.KICK_CLIENT_ID || '').trim(), client_secret: (process.env.KICK_CLIENT_SECRET || '').trim() }) });
  if (!r.ok) throw new Error("token " + r.status);
  const j = await r.json(); tok = j.access_token; tokExp = Date.now() + ((j.expires_in || 3600) - 300) * 1000; return tok;
}
// English-only directory: drop anyone whose Kick language isn't English or whose title has another language in it
const FOREIGN = new Set("el los las una que para por pero hola vamos hoy ahora directo bueno vivo les des avec pour dans nous vous pas tres bonjour und der das nicht mit ich ist fur heute nao voce uma tudo hoje ao il che sono ciao bir ile het een".split(" "));
const NON_LATIN = /[\u0370-\u03FF\u0400-\u052F\u0590-\u06FF\u0750-\u077F\u0900-\u0DFF\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const ACCENT = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u017F\u00BF\u00A1]/g;
export const whyNot = s => {
  const lang = String(s.language || "").trim();
  if (lang && !/^(en|english)/i.test(lang)) return "language=" + lang;
  const t = String(s.stream_title || "");
  if (NON_LATIN.test(t)) return "non-latin script";
  if ((t.match(ACCENT) || []).length >= 2) return "accented letters";
  const words = (t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) || []);
  const w = words.find(x => FOREIGN.has(x));
  return w ? "word=" + w : "";
};
export const isEnglish = s => !whyNot(s);
const thumbOf = s => { const t = s.thumb || s.thumbnail; const u = typeof t === "string" ? t : (t && (t.src || t.url)) || ""; return /^https:\/\//.test(u) ? u : ""; };
async function keylessIrl() {
  const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
  for (const u of ["https://kick.com/stream/livestreams/en?page=1&limit=100&subcategory=irl&sort=desc", "https://kick.com/stream/livestreams/en?page=1&limit=100&sort=desc"]) {
    try {
      const r = await fetch(u, { headers: UA }); if (!r.ok) continue;
      const j = await r.json(), arr = Array.isArray(j) ? j : (j.data || []);
      const out = arr.map(x => ({ slug: (x.channel && x.channel.slug) || x.slug, stream_title: x.session_title || x.stream_title || "", viewer_count: x.viewer_count ?? x.viewers ?? 0, language: x.language || "en", thumb: (x.thumbnail && (x.thumbnail.src || x.thumbnail.url)) || (typeof x.thumbnail === "string" ? x.thumbnail : ""), cat: (x.categories && x.categories[0] && x.categories[0].name) || (x.category && x.category.name) || "" })).filter(x => x.slug && /irl/i.test(x.cat));
      if (out.length) return out;
    } catch (e) {}
  }
  return [];
}
export default async (req) => {
  const h = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" };
  if (!/[?&]debug/.test(req.url) && cache && Date.now() - cacheAt < 60000) return new Response(JSON.stringify(cache), { headers: h });
  try {
    const A = { authorization: "Bearer " + await token() };
    const dbg = new URL(req.url).searchParams.get("debug");
    // ask Kick for English IRL streams directly (finds far more than scanning the top 100 overall); fall back to the broad scan
    let all = [], mode = "broad", catId = null;
    try {
      const cr = await fetch("https://api.kick.com/public/v1/categories?q=IRL", { headers: A });
      const cj = cr.ok ? await cr.json() : {};
      const cat = (cj.data || []).find(c => String(c.name || "").toLowerCase() === "irl") || (cj.data || [])[0];
      if (cat && cat.id != null) {
        catId = cat.id;
        const lr = await fetch("https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count&language=en&category_id=" + encodeURIComponent(cat.id), { headers: A });
        if (lr.ok) { all = (await lr.json()).data || []; mode = "targeted"; }
      }
    } catch (e) {}
    if (!all.length) {
      const r = await fetch("https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count", { headers: A });
      if (!r.ok) throw new Error("livestreams " + r.status);
      all = (await r.json()).data || []; mode = "broad";
    }
    const irlAll = mode === "targeted" ? all : all.filter(s => /irl/i.test((s.category && s.category.name) || ""));
    if (dbg) return new Response(JSON.stringify({ mode, catId, total: all.length, irl: irlAll.length, languages: [...new Set(all.map(s => s.language))].slice(0, 15), sample: irlAll.slice(0, 12).map(s => ({ title: String(s.stream_title || "").slice(0, 60), language: s.language, why: whyNot(s) || "kept" })) }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    let list = irlAll.filter(isEnglish);
    if (list.length < 20) { const have = new Set(list.map(x => x.slug)); list = list.concat(irlAll.filter(x => !have.has(x.slug) && (!x.language || /^(en|english)/i.test(String(x.language))))); }
    cache = { ok: true, streams: list.slice(0, 20).map(s => ({ slug: s.slug, title: s.stream_title, viewers: s.viewer_count, thumb: thumbOf(s) })) };
    cacheAt = Date.now();
    return new Response(JSON.stringify(cache), { headers: h });
  } catch (e) {
    try {
      const raw = (await keylessIrl()).sort((a, b) => b.viewer_count - a.viewer_count); let list = raw.filter(isEnglish);
      if (list.length < 20) { const have = new Set(list.map(x => x.slug)); list = list.concat(raw.filter(x => !have.has(x.slug) && (!x.language || /^(en|english)/i.test(String(x.language))))); }
      if (list.length) { cache = { ok: true, streams: list.slice(0, 20).map(s => ({ slug: s.slug, title: s.stream_title, viewers: s.viewer_count, thumb: thumbOf(s) })) }; cacheAt = Date.now(); return new Response(JSON.stringify(cache), { headers: h }); }
    } catch (e2) {}
    return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } });
  }
};
