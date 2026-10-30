export const config = { path: "/api/prices" };
// Live crypto prices for the top bar. One request from the site; this function does the fetching so no browser blocks it.
const COINS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", USDT: "tether" };
let cache = null, at = 0;
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=5" } });
async function get(u, ms = 5000) { const c = new AbortController(), t = setTimeout(() => c.abort(), ms); try { return await fetch(u, { signal: c.signal, headers: { "user-agent": "ouri-live-site/1.0" } }); } finally { clearTimeout(t); } }
export default async () => {
  if (cache && Date.now() - at < 10000) return J(cache);
  const prices = {};
  await Promise.all(Object.keys(COINS).map(async sym => {
    try { const r = await get("https://api.coinbase.com/v2/prices/" + sym + "-USD/spot"); const v = parseFloat((await r.json()).data.amount); if (isFinite(v) && v > 0) prices[sym] = v; } catch (e) {}
  }));
  const missing = Object.keys(COINS).filter(s => !(s in prices));
  if (missing.length) {
    try {
      const r = await get("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=" + missing.map(s => COINS[s]).join(","));
      const j = await r.json();
      for (const s of missing) { const v = j[COINS[s]] && j[COINS[s]].usd; if (isFinite(v) && v > 0) prices[s] = v; }
    } catch (e) {}
  }
  if (Object.keys(prices).length) { cache = { ok: true, prices: { ...(cache && cache.prices), ...prices } }; at = Date.now(); return J(cache); }
  return J(cache || { ok: false }, cache ? 200 : 502);
};
