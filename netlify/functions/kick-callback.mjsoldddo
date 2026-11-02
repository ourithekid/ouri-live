import { getStore } from "@netlify/blobs";
export const config = { path: "/api/kick-callback" };
const page = (t, body) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${t}</title><body style="font:16px system-ui;background:#07130c;color:#fff;padding:1.2rem;max-width:36rem;margin:auto"><h2>${t}</h2>${body}<p><a style="color:#53fc18" href="/">Back to the site</a></p>`, { headers: { "content-type": "text/html; charset=utf-8" } });
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return page("Kick connection", "<p>Missing code. Start again from <b>/api/kick-auth?key=YOUR_OWNER_KEY</b>.</p>");
  const s = getStore("ouri-private");
  const m = (await s.get("pkce", { type: "json" })) || {};
  const verifier = m[state]; if (!verifier) return page("Kick connection", "<p>That sign-in link expired. Start again.</p>");
  delete m[state]; await s.setJSON("pkce", m);
  const redirect = url.origin + "/api/kick-callback";
  const tr = await fetch("https://id.kick.com/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: (process.env.KICK_CLIENT_ID || "").trim(), client_secret: (process.env.KICK_CLIENT_SECRET || "").trim(), redirect_uri: redirect, code_verifier: verifier, code }) });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) return page("Kick connection failed", `<p>Token step: ${tr.status}</p><pre style="white-space:pre-wrap">${esc(JSON.stringify(tj).slice(0, 400))}</pre><p>Check the Redirect URL in your Kick app is exactly <b>${esc(redirect)}</b>.</p>`);
  await s.setJSON("auth", { access: tj.access_token, refresh: tj.refresh_token, at: Date.now() });
  const H = { authorization: "Bearer " + tj.access_token, "content-type": "application/json" };
  const ur = await fetch("https://api.kick.com/public/v1/users", { headers: H });
  const uj = await ur.json().catch(() => ({}));
  const u = (uj.data || [])[0] || {};
  if (!u.user_id) return page("Kick connection", `<p>Signed in, but couldn't read your user (${ur.status}).</p><pre>${esc(JSON.stringify(uj).slice(0, 300))}</pre>`);
  const sr = await fetch("https://api.kick.com/public/v1/events/subscriptions", { method: "POST", headers: H, body: JSON.stringify({ broadcaster_user_id: u.user_id, method: "webhook", events: [{ name: "channel.subscription.gifts", version: 1 }, { name: "kicks.gifted", version: 1 }, { name: "chat.message.sent", version: 1 }, { name: "livestream.status.updated", version: 1 }] }) });
  const sj = await sr.json().catch(() => ({}));
  const good = sr.ok;
  return page(good ? "Connected ✓" : "Almost there", `<p>Signed in as <b>${esc(u.name || u.user_id)}</b>.</p><p>Subscribing to gift + chat + stream events: <b>${sr.status}</b> ${good ? "(done)" : "(failed)"}</p><pre style="white-space:pre-wrap">${esc(((sj.data || []).map(d => (d.name || "?") + ": " + (d.error ? "ERROR " + d.error : "ok")).join("\n")) || JSON.stringify(sj).slice(0, 700))}</pre>${good ? "<p>Gifted subs and KICKs will now update the leaderboards automatically.</p>" : "<p>Send me this page and I'll fix it.</p>"}`);
};
