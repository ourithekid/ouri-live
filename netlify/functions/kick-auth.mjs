import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/kick-auth" };
const b64 = b => Buffer.from(b).toString("base64url");

export default async (req) => {
  const url = new URL(req.url);
  if (!process.env.OWNER_KEY || url.searchParams.get("key") !== process.env.OWNER_KEY) return new Response("Owner only. Add ?key=YOUR_OWNER_KEY to the address.", { status: 403 });
  const id = (process.env.KICK_CLIENT_ID || "").trim();
  if (!id) return new Response("KICK_CLIENT_ID is not set in Netlify.", { status: 500 });
  const verifier = b64(crypto.randomBytes(32)), state = b64(crypto.randomBytes(16));
  const challenge = b64(crypto.createHash("sha256").update(verifier).digest());
  const s = getStore("ouri-private");
  const m = (await s.get("pkce", { type: "json" })) || {};
  m[state] = verifier; const ks = Object.keys(m); if (ks.length > 10) delete m[ks[0]];
  await s.setJSON("pkce", m);
  const redirect = url.origin + "/api/kick-callback";
  const q = new URLSearchParams({ response_type: "code", client_id: id, redirect_uri: redirect, scope: url.searchParams.get("nokicks") ? "user:read channel:read events:subscribe" : "user:read channel:read events:subscribe kicks:read", code_challenge: challenge, code_challenge_method: "S256", state });
  return Response.redirect("https://id.kick.com/oauth/authorize?" + q.toString(), 302);
};
