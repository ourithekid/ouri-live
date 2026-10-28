import { getStore } from "@netlify/blobs";
export const config = { path: "/api/db" };

const store = () => getStore("ouri");
const OPEN_ADD = new Set(["clips"]);           // anyone can submit
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const split = p => { const i = p.indexOf("/"); return [p.slice(0, i), p.slice(i + 1)]; };
const clean = s => String(s || "").replace(/[<>]/g, "").slice(0, 300);

export default async (req) => {
  const url = new URL(req.url);
  const owner = !!process.env.OWNER_KEY && req.headers.get("x-owner-key") === process.env.OWNER_KEY;
  const s = store();

  if (req.method === "GET") {
    const col = url.searchParams.get("col");
    const doc = url.searchParams.get("doc");
    if (col) {
      const m = (await s.get(col, { type: "json" })) || {};
      return J({ docs: Object.entries(m).map(([id, d]) => ({ id, ...d })) });
    }
    if (doc) {
      const [c, id] = split(doc);
      const m = (await s.get(c, { type: "json" })) || {};
      return J({ data: m[id] ?? null });
    }
    return J({ error: "bad request" }, 400);
  }

  if (req.method !== "POST") return J({ error: "method" }, 405);
  let b; try { b = await req.json(); } catch { return J({ error: "json" }, 400); }
  const { op, path, data } = b;
  const [c, rawId] = split(path || "/");
  if (!c) return J({ error: "path" }, 400);
  const m = (await s.get(c, { type: "json" })) || {};

  if (op === "add") {
    if (!owner && !OPEN_ADD.has(c)) return J({ error: "owner only" }, 403);
    if (Object.keys(m).length >= 500) return J({ error: "full" }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const d = { ...data };
    for (const k of Object.keys(d)) if (typeof d[k] === "string") d[k] = clean(d[k]);
    if (c === "clips" && !/^https?:\/\//.test(d.url || "")) return J({ error: "url" }, 400);
    m[id] = d; await s.setJSON(c, m); return J({ id });
  }
  if (op === "set") {
    const isVote = c === "votes";                      // voters may only write their own doc
    if (!owner && !isVote) return J({ error: "owner only" }, 403);
    if (isVote) { const v = (data && data.v) || {}; for (const k of Object.keys(v)) if (v[k] !== 1 && v[k] !== -1) delete v[k]; m[rawId] = { v }; }
    else m[rawId] = data;
    await s.setJSON(c, m); return J({ ok: true });
  }
  if (op === "delete") {
    if (!owner) return J({ error: "owner only" }, 403);
    delete m[rawId]; await s.setJSON(c, m); return J({ ok: true });
  }
  return J({ error: "op" }, 400);
};
