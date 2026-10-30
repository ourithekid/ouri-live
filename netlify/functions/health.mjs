import { getStore } from "@netlify/blobs";
export const config = { path: "/api/health" };
const J = (o) => new Response(JSON.stringify(o, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
async function probe(name, fn) {
  try { const r = await fn(); return [name, r]; } catch (e) { return [name, "ERROR " + (e && e.message || e)]; }
}
export default async () => {
  const e = process.env, out = { env: {}, db: null, upstream: {} };
  for (const k of ["OWNER_KEY", "KICK_CLIENT_ID", "KICK_CLIENT_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "YT_API_KEY"]) out.env[k] = e[k] ? "set" : "MISSING";
  try {
    const s = getStore("ouri-private");
    await s.setJSON("healthcheck", { t: Date.now() });
    out.db = "ok (read/write works)";
  } catch (x) { out.db = "FAILED: " + (x && x.message || x); }
  const checks = [
    probe("kick_oauth_token", async () => {
      if (!e.KICK_CLIENT_ID || !e.KICK_CLIENT_SECRET) return "skipped (keys missing)";
      const r = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: e.KICK_CLIENT_ID.trim(), client_secret: e.KICK_CLIENT_SECRET.trim() }) });
      return r.status + (r.ok ? " ok" : " " + (await r.text()).slice(0, 80));
    }),
    probe("kick_weekly_clips_unofficial", async () => {
      const r = await fetch("https://kick.com/api/v2/channels/ouri/clips?cursor=0&sort=view&time=week", { headers: { "user-agent": UA, accept: "application/json" } });
      return r.status + (r.ok ? " ok" : " blocked/failed");
    }),
    probe("twitch_gql", async () => {
      const r = await fetch("https://gql.twitch.tv/gql", { method: "POST", headers: { "client-id": "kimne78kx3ncx6brgo4mv6wki5h1ko" }, body: JSON.stringify([{ query: "{ games(first:1){ edges{ node{ name } } } }" }]) });
      return r.status + (r.ok ? " ok" : " failed");
    }),
    probe("twitch_helix_token", async () => {
      if (!e.TWITCH_CLIENT_ID || !e.TWITCH_CLIENT_SECRET) return "skipped (keys missing)";
      const r = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: e.TWITCH_CLIENT_ID.trim(), client_secret: e.TWITCH_CLIENT_SECRET.trim() }) });
      return r.status + (r.ok ? " ok" : " failed");
    }),
  ];
  for (const [k, v] of await Promise.all(checks)) out.upstream[k] = v;
  return J(out);
};
