// Shared helpers for the stream overlay: DoorDash earnings counter + viewer sound board (used by chat, kick-webhook, kick-count and overlay)
import { getStore } from "@netlify/blobs";
const pub = () => getStore({ name: "ouri", consistency: "strong" });
const prv = () => getStore({ name: "ouri-private", consistency: "strong" });

// ---- sound board ----
// Preset sounds are synthesized by the overlay page itself (no audio files needed); custom ones are uploaded by the owner.
export const PRESETS = [
  { id: "p-airhorn", name: "Air horn", price: 60 }, { id: "p-ding", name: "Ding", price: 20 }, { id: "p-rimshot", name: "Ba dum tss", price: 40 },
  { id: "p-trombone", name: "Sad trombone", price: 50 }, { id: "p-laser", name: "Laser", price: 30 }, { id: "p-coin", name: "Coin", price: 20 },
  { id: "p-buzzer", name: "Wrong buzzer", price: 40 }, { id: "p-siren", name: "Siren", price: 50 },
  { id: "p-boom", name: "Vine boom", price: 40 }, { id: "p-bruh", name: "Bruh groan", price: 30 }, { id: "p-dun", name: "Dun dun dun", price: 50 }, { id: "p-scratch", name: "Record scratch", price: 40 }, { id: "p-crickets", name: "Crickets", price: 30 }, { id: "p-slideup", name: "Slide whistle up", price: 30 }, { id: "p-slidedown", name: "Slide whistle down", price: 30 }, { id: "p-boing", name: "Boing", price: 30 }, { id: "p-cash", name: "Cha-ching", price: 40 }, { id: "p-boomx", name: "Explosion", price: 60 }, { id: "p-fanfare", name: "Victory fanfare", price: 60 }, { id: "p-levelup", name: "Level up", price: 30 }, { id: "p-gameover", name: "Game over", price: 40 }, { id: "p-alarm", name: "Alarm beeps", price: 40 }, { id: "p-phone", name: "Ringing phone", price: 30 }, { id: "p-doorbell", name: "Doorbell", price: 20 }, { id: "p-knock", name: "Knock knock", price: 20 }, { id: "p-heartbeat", name: "Heartbeat", price: 30 }, { id: "p-stab", name: "Horror stab", price: 40 }, { id: "p-tada", name: "Ta-da", price: 30 }, { id: "p-applause", name: "Applause", price: 50 }, { id: "p-boo", name: "Crowd boo", price: 40 }, { id: "p-drumroll", name: "Drum roll", price: 40 }, { id: "p-cymbal", name: "Cymbal crash", price: 30 }, { id: "p-pop", name: "Pop", price: 15 }, { id: "p-sparkle", name: "Magic sparkle", price: 30 }, { id: "p-tick", name: "Clock tick tock", price: 20 }, { id: "p-rev", name: "Revving engine", price: 40 }, { id: "p-flush", name: "Toilet flush", price: 30 }, { id: "p-honk", name: "Car honk", price: 30 }, { id: "p-bell", name: "Boxing bell", price: 30 }, { id: "p-error", name: "Error beep", price: 20 }, { id: "p-whoosh", name: "Whoosh", price: 20 }, { id: "p-punch", name: "Punch hit", price: 30 }, { id: "p-whoopee", name: "Whoopee", price: 30 }, { id: "p-horns", name: "Air horn spam", price: 60 }, { id: "p-violin", name: "Sad violin", price: 40 }, { id: "p-drone", name: "Ominous drone", price: 30 }, { id: "p-ufo", name: "UFO", price: 30 }, { id: "p-wah", name: "Wah wah wah", price: 40 },
  { id: "p-ohno", name: "Oh no (falling notes)", price: 30 }, { id: "p-ping", name: "Notification ping", price: 15 }, { id: "p-chime", name: "Door chime", price: 20 }, { id: "p-bonk", name: "Bonk", price: 25 }, { id: "p-slap", name: "Slap", price: 25 }, { id: "p-squeak", name: "Squeaky toy", price: 25 }, { id: "p-quack", name: "Duck quack", price: 30 }, { id: "p-meow", name: "Meow-ish", price: 30 }, { id: "p-dog", name: "Bark", price: 30 }, { id: "p-chicken", name: "Chicken cluck", price: 30 }, { id: "p-rooster", name: "Rooster call", price: 30 }, { id: "p-owl", name: "Owl hoot", price: 20 }, { id: "p-gong", name: "Gong", price: 30 }, { id: "p-kungfu", name: "Kung fu hit", price: 30 }, { id: "p-sword", name: "Sword draw", price: 30 }, { id: "p-teleport", name: "Teleport", price: 30 }, { id: "p-powerup", name: "Power up", price: 30 }, { id: "p-powerdown", name: "Power down", price: 30 }, { id: "p-select", name: "Menu select", price: 15 }, { id: "p-jump", name: "Jump", price: 20 }, { id: "p-oneup", name: "Extra life", price: 30 }, { id: "p-wilhelm", name: "Falling scream", price: 40 }, { id: "p-sparkdown", name: "Glitch", price: 25 }, { id: "p-static", name: "TV static", price: 25 }, { id: "p-dialup", name: "Dial-up modem", price: 30 }, { id: "p-camera", name: "Camera shutter", price: 20 }, { id: "p-cashreg", name: "Cash register", price: 35 }, { id: "p-kiss", name: "Smooch", price: 25 }, { id: "p-hiccup", name: "Hiccup", price: 20 }, { id: "p-burp", name: "Burp", price: 30 }, { id: "p-sneeze", name: "Sneeze", price: 25 }, { id: "p-snore", name: "Snore", price: 25 }, { id: "p-yawn", name: "Yawn", price: 20 }, { id: "p-baby", name: "Baby giggle", price: 25 }, { id: "p-evil", name: "Evil laugh", price: 35 }, { id: "p-sitcom", name: "Sitcom laugh track", price: 40 }, { id: "p-awww", name: "Aww", price: 25 }, { id: "p-ohh", name: "Crowd ooh", price: 30 }, { id: "p-cheer", name: "Crowd cheer", price: 45 }, { id: "p-tension", name: "Tension riser", price: 35 }, { id: "p-countdown", name: "Countdown beeps", price: 30 }, { id: "p-bomb", name: "Bomb beeps", price: 30 },
  { id: "p-censor", name: "Censor beep", price: 25 }, { id: "p-hitmark", name: "Hitmarker", price: 25 }, { id: "p-pipe", name: "Metal pipe clang", price: 35 }, { id: "p-bassdrop", name: "Bass drop", price: 50 }, { id: "p-wub", name: "Dubstep wub", price: 40 }, { id: "p-rewind", name: "Tape rewind", price: 35 }, { id: "p-glass", name: "Glass break", price: 35 }, { id: "p-tiptoe", name: "Sneaky tiptoe", price: 25 }, { id: "p-slip", name: "Cartoon slip", price: 30 }, { id: "p-surprise", name: "Surprise sting", price: 40 }, { id: "p-creak", name: "Door creak", price: 25 }, { id: "p-drip", name: "Water drip", price: 15 }, { id: "p-thunder", name: "Thunder", price: 40 }, { id: "p-wind", name: "Spooky wind", price: 25 }, { id: "p-ghost", name: "Ghost wail", price: 30 }, { id: "p-tires", name: "Tire screech", price: 35 }, { id: "p-heli", name: "Helicopter", price: 30 }, { id: "p-bubble", name: "Bubble pop", price: 15 }, { id: "p-sparklecash", name: "Money rain", price: 35 }, { id: "p-lag", name: "Lag spike", price: 30 }, { id: "p-disc", name: "Stream disconnect", price: 30 }, { id: "p-reconnect", name: "Reconnected", price: 30 },
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

// ---- Kick sound credits: every gifted sub / resub = 500, every gifted KICK = 1 (sound board only, never levels or leaderboards) ----
// Credits are earned by KICK username and counted for the site account that linked that Kick name (by typing a one-time code in Kick chat).
export const SUB_CREDIT = 500, KICK_CREDIT = 1;
export async function kickCredit(name, amt) {
  const key = String(name || "").toLowerCase().trim(); amt = Math.round(Number(amt) || 0); if (!key || amt <= 0) return;
  const P = prv(), c = (await P.get("kcred", { type: "json" })) || {}; c[key] = (c[key] || 0) + amt;
  const ks = Object.keys(c); if (ks.length > 5000) for (const k of ks.sort((a, b) => c[a] - c[b]).slice(0, ks.length - 5000)) delete c[k];
  await P.setJSON("kcred", c);
}
export async function kcFor(id) {   // { kc: credits, kn: linked kick name }
  const P = prv(), m = (await P.get("kmap", { type: "json" })) || {}, c = (await P.get("kcred", { type: "json" })) || {};
  let kc = 0, kn = ""; for (const k of Object.keys(m)) if (m[k].id === id) { kc += c[k] || 0; kn = m[k].n || k; }
  return { kc, kn };
}
export async function kickLinkNew(id) {   // site account asks for a code to type in Kick chat
  const P = prv(), l = (await P.get("klcodes", { type: "json" })) || {}, now = Date.now();
  for (const k of Object.keys(l)) if (l[k].exp < now || l[k].id === id) delete l[k];
  let code = ""; const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; for (let i = 0; i < 6; i++) code += A[Math.floor(Math.random() * A.length)];
  l[code] = { id, exp: now + 15 * 60000 }; await P.setJSON("klcodes", l); return code;
}
export async function kickLinkTry(name, text) {   // called for every chat message that starts with !link
  const m = String(text || "").trim().match(/^!link\s+([A-Za-z0-9]{6})\b/); if (!m || !name) return false;
  const P = prv(), l = (await P.get("klcodes", { type: "json" })) || {}, code = m[1].toUpperCase(), e = l[code];
  if (!e || e.exp < Date.now()) return false;
  const km = (await P.get("kmap", { type: "json" })) || {}, key = String(name).toLowerCase();
  for (const k of Object.keys(km)) if (km[k].id === e.id) delete km[k];   // one Kick name per site account
  km[key] = { id: e.id, n: String(name).slice(0, 40) }; delete l[code];
  await P.setJSON("kmap", km); await P.setJSON("klcodes", l); return true;
}
