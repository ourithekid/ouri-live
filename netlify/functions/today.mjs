export const config = { path: "/api/today" };
// Data for the top-bar "Today" panel: crypto details, Fear & Greed, BTC dominance and live sports scores.
// Public, read-only. Results are cached for a short time so the free data sites are not hit on every tap.
const H = { "content-type": "application/json", "cache-control": "public, max-age=20", "access-control-allow-origin": "*" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const getJ = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error("http " + r.status); return r.json(); };
const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.v;
  try { const v = await fn(); cache.set(key, { at: Date.now(), v }); return v; }
  catch (e) { if (c) return c.v; throw e; }
}
const num = (v) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const COINS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", USDT: "tether", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink", LTC: "litecoin", DOT: "polkadot", SUI: "sui", SHIB: "shiba-inu" };
const EXTRA = new Set(["DOGE", "ADA", "AVAX", "LINK", "LTC", "DOT", "SUI", "SHIB"]);
const LEAGUES = { nba: "basketball/nba", nfl: "football/nfl", nhl: "hockey/nhl", mlb: "baseball/mlb", epl: "soccer/eng.1", mls: "soccer/usa.1" };

// Coinbase Exchange public data (works from the server; CoinGecko often refuses shared hosts)
async function coinbaseCoin(sym) {
  const base = "https://api.exchange.coinbase.com/products/" + sym + "-USD";
  const [st, ca] = await Promise.all([
    getJ(base + "/stats"),
    getJ(base + "/candles?granularity=3600").catch(() => []),
  ]);
  const p = num(st && st.last), o = num(st && st.open);
  if (p == null) throw new Error("no price");
  const rows = (Array.isArray(ca) ? ca : []).slice(0, 168).reverse();
  const closes = rows.map((r) => num(r[4])).filter((x) => x != null);
  const step = Math.max(1, Math.floor(closes.length / 24));
  const sp = closes.filter((_, i) => i % step === 0).map((x) => Math.round(x * 10000) / 10000);
  if (sp.length) sp[sp.length - 1] = p;
  return { s: sym, p, c: o ? ((p - o) / o) * 100 : null, sp, ex: EXTRA.has(sym) ? 1 : 0 };
}
async function crypto() {
  const ids = Object.values(COINS).join(",");
  const syms = Object.keys(COINS);
  const [cb, fng, glob] = await Promise.all([
    Promise.all(syms.map((s) => coinbaseCoin(s).catch(() => null))),
    getJ("https://api.alternative.me/fng/?limit=1").catch(() => null),
    getJ("https://api.coingecko.com/api/v3/global").catch(() => null),
  ]);
  const bySym = {};
  cb.forEach((c) => { if (c) bySym[c.s] = c; });
  if (syms.some((s) => !bySym[s])) {
    const mk = await getJ("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" + ids + "&sparkline=true&price_change_percentage=24h").catch(() => null);
    (Array.isArray(mk) ? mk : []).forEach((c) => {
      const s = String(c.symbol || "").toUpperCase(); if (!COINS[s] || bySym[s]) return;
      const sp = c.sparkline_in_7d && Array.isArray(c.sparkline_in_7d.price) ? c.sparkline_in_7d.price : [];
      const step = Math.max(1, Math.floor(sp.length / 24));
      bySym[s] = { s, ex: EXTRA.has(s) ? 1 : 0, p: num(c.current_price), c: num(c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h), sp: sp.filter((_, i) => i % step === 0).map((x) => Math.round(x * 10000) / 10000) };
    });
  }
  const coins = syms.map((s) => bySym[s]).filter(Boolean);
  const f = fng && fng.data && fng.data[0] ? { v: num(fng.data[0].value), c: String(fng.data[0].value_classification || "") } : null;
  let dom = glob && glob.data && glob.data.market_cap_percentage ? num(glob.data.market_cap_percentage.btc) : null;
  if (!coins.length && !f && dom == null) throw new Error("no crypto data");
  if (!coins.length) throw new Error("no coin prices");
  return { ok: true, coins, fng: f, dom, at: Date.now() };
}

async function scores(lg) {
  const path = LEAGUES[lg]; if (!path) throw new Error("bad league");
  const j = await getJ("https://site.api.espn.com/apis/site/v2/sports/" + path + "/scoreboard");
  const games = [];
  (j.events || []).forEach((e) => {
    const comp = e.competitions && e.competitions[0]; if (!comp) return;
    const cs = comp.competitors || [];
    const away = cs.find((x) => x.homeAway === "away") || cs[1], home = cs.find((x) => x.homeAway === "home") || cs[0];
    if (!away || !home) return;
    const st = (e.status && e.status.type) || {};
    const ab = (x) => (x.team && (x.team.abbreviation || x.team.shortDisplayName || x.team.displayName)) || "?";
    games.push({ a: ab(away), as: num(away.score), h: ab(home), hs: num(home.score), st: st.state || "pre", d: st.shortDetail || st.detail || "", t: e.date || "" });
  });
  const rank = { in: 0, pre: 1, post: 2 };
  games.sort((x, y) => (rank[x.st] ?? 3) - (rank[y.st] ?? 3) || String(x.t).localeCompare(String(y.t)));
  return { ok: true, lg, games: games.slice(0, 14), at: Date.now() };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...H, "access-control-allow-methods": "GET", "access-control-allow-headers": "*" } });
  const q = new URL(req.url).searchParams, x = q.get("x") || "";
  try {
    if (x === "crypto") return J(await cached("crypto", 60000, crypto));
    if (x === "scores") { const lg = (q.get("lg") || "nba").toLowerCase(); return J(await cached("s:" + lg, 25000, () => scores(lg))); }
    return J({ ok: false, error: "use ?x=crypto or ?x=scores&lg=nba" }, 400);
  } catch (e) { return J({ ok: false, error: String((e && e.message) || e) }, 502); }
};
