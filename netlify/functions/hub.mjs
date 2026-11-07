export const config = { path: "/api/hub" };
// Data for the TRENDING tab: stocks, Pokemon card prices, Pokemon news, world news.
// Public, read-only, cached briefly so the free data sources are not hit on every refresh.
const H = { "content-type": "application/json", "cache-control": "public, max-age=30", "access-control-allow-origin": "*" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const UA = { accept: "application/json,text/xml,*/*", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const getJ = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error("http " + r.status); return r.json(); };
const getT = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error("http " + r.status); return r.text(); };
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.v;
  try { const v = await fn(); cache.set(key, { at: Date.now(), v }); return v; }
  catch (e) { if (c) return c.v; throw e; }
}
const num = (v) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const r2 = (n) => Math.round(n * 100) / 100;

/* ---------- stocks (Yahoo Finance chart data) ---------- */
const STOCKS = [["^GSPC", "S&P 500"], ["^IXIC", "NASDAQ"], ["TSLA", "TESLA"], ["NVDA", "NVIDIA"]];
async function stocks() {
  const out = await Promise.all(STOCKS.map(async ([sym, name]) => {
    try {
      const j = await getJ("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?range=1d&interval=15m");
      const r = j.chart && j.chart.result && j.chart.result[0]; if (!r) return null;
      const m = r.meta || {}, cl = ((r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close) || []).filter((x) => x != null);
      const p = num(m.regularMarketPrice), prev = num(m.chartPreviousClose ?? m.previousClose);
      if (p == null) return null;
      const step = Math.max(1, Math.floor(cl.length / 24));
      return { s: sym, n: name, p: r2(p), c: prev ? r2(((p - prev) / prev) * 100) : null, sp: cl.filter((_, i) => i % step === 0).map((x) => r2(x)), open: m.marketState ? m.marketState === "REGULAR" : null };
    } catch (e) { return null; }
  }));
  const list = out.filter(Boolean);
  if (!list.length) throw new Error("no stock data");
  return { ok: true, stocks: list, at: Date.now() };
}

/* ---------- Pokemon card + sealed prices (TCGplayer prices via tcgcsv.com) ---------- */
const CSV = "https://tcgcsv.com/tcgplayer/3";
const SEALED = /(booster box|elite trainer box|booster bundle|ultra-premium collection)/i;
const NOT = /(case|code card|display|sleeved|half|pack art|\bpack\b(?!.*box))/i;
async function pokemon() {
  const g = await getJ(CSV + "/groups");
  const groups = (g.results || []).filter((x) => x.publishedOn && !/(promo|trainer kit|deck|trading card game classic|pokemon go|mcdonald|battle academy|prize pack|world championship|jumbo|energies|blister)/i.test(x.name || ""))
    .sort((a, b) => String(b.publishedOn).localeCompare(String(a.publishedOn))).slice(0, 5);
  const sets = await Promise.all(groups.map(async (gr) => {
    const [pr, pc] = await Promise.all([getJ(CSV + "/" + gr.groupId + "/products"), getJ(CSV + "/" + gr.groupId + "/prices")]);
    const price = {};
    (pc.results || []).forEach((x) => { const v = num(x.marketPrice ?? x.midPrice); if (v != null && (price[x.productId] == null || v > price[x.productId].v)) price[x.productId] = { v, sub: x.subTypeName }; });
    const items = [];
    (pr.results || []).forEach((p) => {
      const pp = price[p.productId]; if (!pp) return;
      const rar = ((p.extendedData || []).find((e) => e.name === "Rarity") || {}).value || "";
      const sealed = SEALED.test(p.name || "") && !NOT.test(p.name || "");
      const chase = !sealed && /(special illustration|hyper rare|secret rare|ultra rare|illustration rare|mega hyper)/i.test(rar);
      if (sealed || chase) items.push({ id: p.productId, n: String(p.name || "").replace(/\s+\(.*?\)\s*$/, ""), set: gr.name, v: r2(pp.v), k: sealed ? "s" : "c", r: rar, u: p.url || "", i: p.imageUrl || "" });
    });
    return { set: gr.name, items };
  }));
  const all = sets.flatMap((s) => s.items);
  const sealed = all.filter((x) => x.k === "s").sort((a, b) => b.v - a.v).slice(0, 10);
  const cards = all.filter((x) => x.k === "c").sort((a, b) => b.v - a.v).slice(0, 10);
  if (!sealed.length && !cards.length) throw new Error("no pokemon prices");
  return { ok: true, items: sealed.concat(cards), sets: groups.map((x) => x.name), at: Date.now() };
}

/* ---------- news (Google News RSS) ---------- */
const dec = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, "").trim();
function parseRss(xml, n) {
  const items = [];
  (xml.match(/<item>[\s\S]*?<\/item>/g) || []).forEach((it) => {
    const g = (t) => { const m = it.match(new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">")); return m ? dec(m[1]) : ""; };
    let title = g("title"), src = g("source");
    if (src && title.endsWith(" - " + src)) title = title.slice(0, -(src.length + 3));
    const link = g("link"), t = Date.parse(g("pubDate"));
    if (title && /^https:\/\//.test(link)) items.push({ t: title, s: src, h: link, at: Number.isFinite(t) ? t : null });
  });
  return items.slice(0, n);
}
const news = (url, n) => async () => {
  const items = parseRss(await getT(url), n);
  if (!items.length) throw new Error("no news");
  return { ok: true, items, at: Date.now() };
};

/* live Pokemon feed: several searches merged, newest first */
const PQ = ["Pokemon TCG when:2d", "Pokemon Go when:2d", "Pokemon Scarlet Violet OR Legends when:2d", "Pokemon Center OR Pokemon Company when:2d"];
async function pfeed() {
  const lists = await Promise.all(PQ.map((q) => getT("https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=en-US&gl=US&ceid=US:en").then((x) => parseRss(x, 15)).catch(() => [])));
  const seen = new Set(), out = [];
  lists.flat().sort((a, b) => (b.at || 0) - (a.at || 0)).forEach((x) => { const k = x.t.toLowerCase().slice(0, 48); if (seen.has(k)) return; seen.add(k); out.push(x); });
  if (!out.length) throw new Error("no pokemon news");
  return { ok: true, items: out.slice(0, 40), at: Date.now() };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...H, "access-control-allow-methods": "GET", "access-control-allow-headers": "*" } });
  const x = new URL(req.url).searchParams.get("x") || "";
  try {
    if (x === "stocks") return J(await cached("stocks", 45000, stocks));
    if (x === "pokemon") return J(await cached("pokemon", 600000, pokemon));
    if (x === "pnews") return J(await cached("pnews", 600000, news("https://news.google.com/rss/search?q=" + encodeURIComponent("Pokemon TCG when:3d") + "&hl=en-US&gl=US&ceid=US:en", 8)));
    if (x === "pfeed") return J(await cached("pfeed", 90000, pfeed));
    if (x === "world") return J(await cached("world", 300000, news("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en", 20)));
    return J({ ok: false, error: "use ?x=stocks, pokemon, pnews or world" }, 400);
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }, 502); }
};
