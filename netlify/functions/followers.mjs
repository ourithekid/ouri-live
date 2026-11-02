export const config = { path: "/api/followers" };
// Ouri's live follower count for the OBS follower overlay. Public, read-only, CORS-open (the overlay runs from a local file).
const H = { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" };
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: H });
const UA = { accept: "application/json", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
let cache = null, cacheAt = 0, last = null;
const num = v => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
async function viaStatus(req) {
  const r = await fetch(new URL("/api/status", req.url).toString(), { headers: { accept: "application/json" } });
  if (!r.ok) return null; const j = await r.json().catch(() => null);
  return j ? num(j.followers) : null;
}
async function viaKick() {
  for (const u of ["https://kick.com/api/v2/channels/ouri", "https://kick.com/api/v1/channels/ouri"]) {
    try { const r = await fetch(u, { headers: UA }); if (!r.ok) continue; const c = await r.json(); const n = num(c.followers_count ?? c.followersCount ?? (c.user && c.user.followers_count)); if (n != null) return n; } catch {}
  }
  return null;
}
export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...H, "access-control-allow-methods": "GET", "access-control-allow-headers": "*" } });
  if (cache && Date.now() - cacheAt < 10000) return J(cache);
  let n = null;
  try { n = await viaStatus(req); } catch {}
  if (n == null) { try { n = await viaKick(); } catch {} }
  if (n == null) n = last;
  if (n == null) return J({ ok: false, error: "no follower count available" }, 502);
  last = n; cache = { ok: true, followers: n, at: Date.now() }; cacheAt = Date.now();
  return J(cache);
};
