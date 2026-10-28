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
export const isEnglish = s => {
  const lang = String(s.language || "").trim();
  if (lang && !/^(en|english)/i.test(lang)) return false;
  const t = String(s.stream_title || "");
  if (NON_LATIN.test(t)) return false;
  if ((t.match(ACCENT) || []).length >= 2) return false;
  const words = (t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]+/g) || []);
  return !words.some(w => FOREIGN.has(w));
};
export default async () => {
  const h = { "content-type": "application/json", "cache-control": "public, max-age=60" };
  if (cache && Date.now() - cacheAt < 60000) return new Response(JSON.stringify(cache), { headers: h });
  try {
    const r = await fetch("https://api.kick.com/public/v1/livestreams?limit=100&sort=viewer_count", { headers: { authorization: "Bearer " + await token() } });
    if (!r.ok) throw new Error("livestreams " + r.status);
    const list = ((await r.json()).data || []).filter(s => /irl/i.test((s.category && s.category.name) || "")).filter(isEnglish);
    cache = { ok: true, streams: list.slice(0, 24).map(s => ({ slug: s.slug, title: s.stream_title, viewers: s.viewer_count })) };
    cacheAt = Date.now();
    return new Response(JSON.stringify(cache), { headers: h });
  } catch (e) { return new Response(JSON.stringify({ ok: false }), { status: 502, headers: { "content-type": "application/json" } }); }
};
