import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
export const config = { path: "/api/auth" };
// ---- shared safety helpers (copied into each function) ----
const eqSafe = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isOwnerReq = req => !!process.env.OWNER_KEY && eqSafe(req.headers.get("x-owner-key") || "", process.env.OWNER_KEY);
const sameOrigin = req => { const o = req.headers.get("origin"); if (!o) return true; try { const h = new URL(o).host; return h === (req.headers.get("host") || "") || h === new URL(req.url).host; } catch { return false; } };
const hits = new Map();
const limited = (req, key, max, ms) => { const ip = String(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?").split(",")[0].trim(); const k = key + "|" + ip, now = Date.now(); let h = hits.get(k); if (!h || now - h.t > ms) { h = { t: now, n: 0 }; hits.set(k, h); } h.n++; if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.t > ms) hits.delete(kk); return h.n > max; };


// Accounts live in the PRIVATE store only. Emails are stored as a one-way hash, never shown anywhere. Passwords are salted + scrypt-hashed.
const st = () => getStore({ name: "ouri-private", consistency: "strong" });
const J = (o, s = 200, extra = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const scr = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k.toString("hex"))));
const RESERVED = new Set(["ouri", "owner", "admin", "administrator", "mod", "moderator", "system", "kick", "support", "staff"]);
const MONTH = 30 * 86400;
const cookie = (v, age) => "ouri_sess=" + v + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + age;
const readTok = req => { const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)ouri_sess=([a-f0-9]{64})/); return m ? m[1] : null; };

async function sessionUser(req) {
  const tok = readTok(req); if (!tok) return null;
  const s = st(); const se = await s.get("sess/" + sha(tok), { type: "json" });
  if (!se || se.exp < Date.now()) return null;
  const u = await s.get("acct/" + se.e, { type: "json" });
  return u ? { id: u.id, name: u.name } : null;
}

async function startSession(s, emailHash) {
  const tok = crypto.randomBytes(32).toString("hex");
  await s.setJSON("sess/" + sha(tok), { e: emailHash, exp: Date.now() + MONTH * 1000 });
  return cookie(tok, MONTH);
}

export default async (req) => {
  if (req.method !== "POST") return J({ error: "method" }, 405);
  if (!sameOrigin(req)) return J({ error: "forbidden" }, 403);
  const raw = await req.text(); if (raw.length > 2000) return J({ error: "Too big." }, 413);
  let b; try { b = JSON.parse(raw); } catch { return J({ error: "Bad request." }, 400); }
  if (!b || typeof b !== "object") return J({ error: "Bad request." }, 400);
  const s = st(); const op = b.op;

  if (op === "me") return J({ user: await sessionUser(req) });

  if (op === "logout") {
    const tok = readTok(req); if (tok) { try { await s.delete("sess/" + sha(tok)); } catch {} }
    return J({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  const email = String(b.email || "").trim().toLowerCase();
  const pw = String(b.password || "");
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || email.length > 254) return J({ error: "Enter a valid email address." }, 400);
  if (pw.length < 8 || pw.length > 100) return J({ error: "Password must be 8 to 100 characters." }, 400);
  if ((b.op === "login" || b.op === "signup") && limited(req, "auth", 25, 900000)) return J({ error: "Too many tries. Wait a few minutes and try again." }, 429);
  const eh = sha(email);

  if (op === "signup") {
    const name = String(b.name || "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return J({ error: "Pick a name with 3 to 20 letters, numbers or underscores." }, 400);
    const norm = name.toLowerCase().replace(/0/g, "o").replace(/[1l]/g, "i").replace(/3/g, "e").replace(/5/g, "s").replace(/_/g, "");
    if (RESERVED.has(name.toLowerCase()) || [...RESERVED].some(r => norm === r || norm === r.replace(/l/g, "i"))) return J({ error: "That name is reserved. Pick another." }, 400);
    const ip = sha(req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?");
    const rl = (await s.get("rl/" + ip, { type: "json" })) || { n: 0, t: Date.now() };
    if (Date.now() - rl.t > 3600000) { rl.n = 0; rl.t = Date.now(); }
    if (rl.n >= 5) return J({ error: "Too many new accounts from this connection. Try again later." }, 429);
    if (await s.get("acct/" + eh, { type: "json" })) return J({ error: "That email already has an account. Try logging in." }, 409);
    if (await s.get("name/" + name.toLowerCase(), { type: "json" })) return J({ error: "That name is taken. Pick another." }, 409);
    const salt = crypto.randomBytes(16).toString("hex");
    const user = { id: crypto.randomBytes(8).toString("hex"), name, salt, hash: await scr(pw, salt), created: Date.now(), fails: 0, lock: 0 };
    await s.setJSON("acct/" + eh, user); await s.setJSON("name/" + name.toLowerCase(), { e: eh });
    rl.n++; await s.setJSON("rl/" + ip, rl);
    return J({ user: { id: user.id, name } }, 200, { "set-cookie": await startSession(s, eh) });
  }

  if (op === "login") {
    const bad = () => J({ error: "Wrong email or password." }, 401);
    const u = await s.get("acct/" + eh, { type: "json" });
    if (!u) { await scr(pw, "0000000000000000"); return bad(); }          // same timing whether or not the email exists
    if (u.lock && u.lock > Date.now()) return J({ error: "Too many tries. Wait 15 minutes and try again." }, 429);
    const h = await scr(pw, u.salt);
    const ok = h.length === u.hash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash));
    if (!ok) { u.fails = (u.fails || 0) + 1; if (u.fails >= 8) { u.lock = Date.now() + 900000; u.fails = 0; } await s.setJSON("acct/" + eh, u); return bad(); }
    if (u.fails || u.lock) { u.fails = 0; u.lock = 0; await s.setJSON("acct/" + eh, u); }
    return J({ user: { id: u.id, name: u.name } }, 200, { "set-cookie": await startSession(s, eh) });
  }
  return J({ error: "op" }, 400);
};
