// Cloudflare Pages worker: runs the same /api functions as Netlify. Routes are generated at build time.
import { setDB } from "./blobs.mjs";
import { route } from "./.routes.mjs";
export default {
  async fetch(request, env) {
    for (const k of Object.keys(env)) if (typeof env[k] === "string") process.env[k] = env[k];
    if (env.DB) setDB(env.DB);
    const h = route(new URL(request.url).pathname);
    if (!h) return env.ASSETS.fetch(request);
    if (!env.DB) return new Response(JSON.stringify({ error: "Database not connected yet." }), { status: 500, headers: { "content-type": "application/json" } });
    const headers = new Headers(request.headers), ip = request.headers.get("cf-connecting-ip"); if (ip) headers.set("x-nf-client-connection-ip", ip);
    try { return await h(new Request(request, { headers }), {}); }
    catch (e) { console.error(e && e.stack || e); return new Response(JSON.stringify({ error: "Server error. Try again." }), { status: 500, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
  },
};
