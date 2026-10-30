// Netlify-Blobs-compatible storage on top of Cloudflare D1, so the same function code runs on both hosts.
let DB = null, ready = null;
export const setDB = d => { DB = d; };
const init = () => ready || (ready = DB.prepare("CREATE TABLE IF NOT EXISTS kv (s TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (s, k)) WITHOUT ROWID").run().catch(e => { ready = null; throw e; }));
export const getStore = o => {
  const name = typeof o === "string" ? o : o.name;
  return {
    async get(k) { await init(); const r = await DB.prepare("SELECT v FROM kv WHERE s = ?1 AND k = ?2").bind(name, k).first(); if (!r) return null; try { return JSON.parse(r.v); } catch { return null; } },
    async setJSON(k, v) { await init(); await DB.prepare("INSERT INTO kv (s, k, v) VALUES (?1, ?2, ?3) ON CONFLICT(s, k) DO UPDATE SET v = excluded.v").bind(name, k, JSON.stringify(v)).run(); },
    async delete(k) { await init(); await DB.prepare("DELETE FROM kv WHERE s = ?1 AND k = ?2").bind(name, k).run(); },
    async list(opt) { await init(); const p = (opt && opt.prefix) || "";
      const r = p ? await DB.prepare("SELECT k FROM kv WHERE s = ?1 AND k >= ?2 AND k < ?3").bind(name, p, p.slice(0, -1) + String.fromCharCode(p.charCodeAt(p.length - 1) + 1)).all() : await DB.prepare("SELECT k FROM kv WHERE s = ?1").bind(name).all();
      return { blobs: (r.results || []).map(x => ({ key: x.k })) }; },
  };
};
