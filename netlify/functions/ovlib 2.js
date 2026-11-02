// Shared helpers for the stream overlay: DoorDash earnings counter + viewer sound board (used by chat, kick-webhook, kick-count and overlay)
import { getStore } from "@netlify/blobs";
const pub = () => getStore({ name: "ouri", consistency: "strong" });

// ---- sound board ----
// Preset sounds are synthesized by the overlay page itself (no audio files needed); custom ones are uploaded by the owner.
export const PRESETS = [
  { id: "p-airhorn", name: "Air horn", price: 60 }, { id: "p-ding", name: "Ding", price: 20 }, { id: "p-rimshot", name: "Ba dum tss", price: 40 },
  { id: "p-trombone", name: "Sad trombone", price: 50 }, { id: "p-laser", name: "Laser", price: 30 }, { id: "p-coin", name: "Coin", price: 20 },
  { id: "p-buzzer", name: "Wrong buzzer", price: 40 }, { id: "p-siren", name: "Siren", price: 50 },
];
export const customSounds = async () => (await pub().get("sfxlist", { type: "json" })) || [];
export const sfxOv = async () => (await pub().get("sfxov", { type: "json" })) || {};   // owner edits to the built-in sounds (name, price, hidden)
export const sfxList = async (all) => {
  const ov = await sfxOv(), pr = PRESETS.map(p => { const x = ov[p.id] || {}; return { id: p.id, name: x.name || p.name, price: x.price || p.price, preset: 1, hidden: !!x.hide }; });
  const l = pr.concat((await customSounds()).map(x => ({ id: x.id, name: x.name, price: x.price })));
  return all ? l : l.filter(x => !x.hidden);
};
export const sfxSetOv = async (id, patch) => { const ov = await sfxOv(); ov[id] = { ...(ov[id] || {}), ...patch }; await pub().setJSON("sfxov", ov); };
export const sfxVol = async () => { const c = (await pub().get("sfxcfg", { type: "json" })) || {}; const v = Number(c.vol); return Number.isFinite(v) ? Math.max(0, Math.min(200, Math.round(v))) : 100; };   // stream volume, percent
export const sfxSetVol = async v => { await pub().setJSON("sfxcfg", { vol: Math.max(0, Math.min(200, Math.round(Number(v) || 0))) }); };
export const sfxQueue = async () => (await pub().get("sfxq", { type: "json" })) || { seq: 0, ev: [] };
export const sfxPush = async (id, name, by) => {
  const s = pub(), q = (await s.get("sfxq", { type: "json" })) || { seq: 0, ev: [] };
  q.seq = (q.seq || 0) + 1; q.ev = (q.ev || []).concat({ seq: q.seq, id, name, by, t: Date.now() }).slice(-30);
  await s.setJSON("sfxq", q); return q;
};

// ---- DoorDash counter: the "day" runs 4:00 AM to 4:00 AM New York time so late-night deliveries still count ----
const dayKey = () => new Date(Date.now() - 4 * 3600000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export const ddGet = async () => {
  const d = (await pub().get("doordash", { type: "json" })) || {}, k = dayKey();
  return d.day === k ? { day: k, c: d.c || 0, n: d.n || 0, h: d.h || [], ids: d.ids || [] } : { day: k, c: 0, n: 0, h: [], ids: [] };
};
const toCents = x => { const v = Math.round(parseFloat(String(x).replace(",", ".")) * 100); return Number.isFinite(v) ? v : NaN; };
export const money = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// "!doordash add 12.50" | "!doordash 12.50" | "!doordash sub 3" | "!doordash set 100" | "!doordash undo" | "!doordash reset"
export async function ddCommand(text, msgId) {
  const m = /^!(?:doordash|dd)\b\s*(.*)$/i.exec(String(text || "").trim()); if (!m) return null;
  const d = await ddGet(); if (msgId && d.ids.includes(String(msgId))) return { dup: true, state: d };
  const p = /^(add|plus|sub|minus|remove|set|reset|clear|undo)?\s*\$?\s*(\d+(?:[.,]\d{1,2})?)?\s*$/i.exec(m[1].trim());
  if (!p) return { ok: false, msg: "Try: !doordash add 12.50", state: d };
  const cmd = (p[1] || (p[2] ? "add" : "")).toLowerCase(), amt = p[2] ? toCents(p[2]) : NaN; let msg = "";
  if ((cmd === "add" || cmd === "plus" || cmd === "sub" || cmd === "minus" || cmd === "remove" || cmd === "set") && !(amt >= 0 && amt <= 500000)) return { ok: false, msg: "Give me an amount, like !doordash add 12.50", state: d };
  if (cmd === "add" || cmd === "plus") { d.c += amt; d.n++; d.h.push({ d: amt, n: 1 }); msg = "added " + money(amt); }
  else if (cmd === "sub" || cmd === "minus" || cmd === "remove") { const x = Math.min(amt, d.c); d.c -= x; d.h.push({ d: -x, n: 0 }); msg = "removed " + money(x); }
  else if (cmd === "set") { d.h.push({ d: amt - d.c, n: 0 }); d.c = amt; msg = "set to " + money(amt); }
  else if (cmd === "undo") { const l = d.h.pop(); if (!l) return { ok: false, msg: "Nothing to undo.", state: d }; d.c = Math.max(0, d.c - l.d); d.n = Math.max(0, d.n - l.n); msg = "undid the last change"; }
  else if (cmd === "reset" || cmd === "clear") { d.c = 0; d.n = 0; d.h = []; msg = "reset to $0.00"; }
  else return { ok: false, msg: "Try: !doordash add 12.50", state: d };
  d.h = d.h.slice(-40); if (msgId) d.ids = d.ids.concat(String(msgId)).slice(-60);
  await pub().setJSON("doordash", d); return { ok: true, msg: "DoorDash total " + msg + ": " + money(d.c), state: d };
}
