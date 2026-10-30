export const config = { path: "/api/emotes" };
// Emote lists for the site chat. Fetched here (not in the browser) and cached for an hour.
//  - BetterTTV + 7TV: global lists, plus the channel lists for the Twitch user below
//  - Twitch: official global + channel (sub) emotes, ONLY if TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set in Netlify
//  - Kick: global + channel emotes from Kick's emote endpoint (best effort: Kick may refuse server requests)
const TWITCH_LOGIN = (process.env.TWITCH_LOGIN || "ouri").toLowerCase();
const KICK_SLUG = (process.env.KICK_SLUG || "ouri").toLowerCase();
let cache = null, at = 0;
const J = o => new Response(JSON.stringify(o), { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } });
const UA = "Mozilla/5.0 (compatible; ouri-live-site/1.0)";
async function get(u, opt = {}, text = false) { const c = new AbortController(), t = setTimeout(() => c.abort(), 6000); try { const r = await fetch(u, { signal: c.signal, ...opt, headers: { "user-agent": UA, accept: "application/json", ...(opt.headers || {}) } }); if (!r.ok) throw new Error(r.status); return text ? await r.text() : await r.json(); } finally { clearTimeout(t); } }
const nameOk = n => /^[A-Za-z0-9_]{2,25}$/.test(String(n));
const num = x => /^[0-9]{1,12}$/.test(String(x));
async function twitchAuth() {
  const id = process.env.TWITCH_CLIENT_ID, sec = process.env.TWITCH_CLIENT_SECRET; if (!id || !sec) return null;
  const j = await get("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "client_id=" + encodeURIComponent(id) + "&client_secret=" + encodeURIComponent(sec) + "&grant_type=client_credentials" });
  return j.access_token ? { id, tok: j.access_token } : null;
}
export default async () => {
  if (cache && Date.now() - at < 3600000) return J(cache);
  const out = { bttv: [], bttvCh: [], seventv: [], seventvCh: [], twitch: [], twitchCh: [], kick: [], kickCh: [], flags: { twitchOfficial: false, kick: false } };
  let tid = ""; const tasks = [];
  tasks.push((async () => { try { const t = (await get("https://decapi.me/twitch/id/" + encodeURIComponent(TWITCH_LOGIN), {}, true)).trim(); if (num(t)) tid = t; } catch (e) {} })());
  tasks.push((async () => { try { const j = await get("https://api.betterttv.net/3/cached/emotes/global"); out.bttv = (Array.isArray(j) ? j : []).filter(e => e && nameOk(e.code) && /^[a-f0-9]{24}$/.test(e.id)).slice(0, 150).map(e => [e.code, e.id]); } catch (e) {} })());
  tasks.push((async () => { try { const j = await get("https://7tv.io/v3/emote-sets/global"); out.seventv = ((j && j.emotes) || []).filter(e => e && nameOk(e.name) && /^[A-Za-z0-9]{10,40}$/.test(e.id)).slice(0, 200).map(e => [e.name, e.id]); } catch (e) {} })());
  tasks.push((async () => { try { // Kick: sets of emotes; the "Global" and "Emoji" sets are shared, the rest belong to the channel
    const j = await get("https://kick.com/emotes/" + encodeURIComponent(KICK_SLUG), { headers: { referer: "https://kick.com/" + KICK_SLUG } });
    (Array.isArray(j) ? j : []).forEach(set => { const glob = /global|emoji/i.test(String(set.id || set.name || set.slug || "")), list = (set.emotes || []).filter(e => e && num(e.id) && nameOk(e.name)).map(e => [e.name, String(e.id)]);
      (glob ? out.kick : out.kickCh).push(...list); });
    out.kick = out.kick.slice(0, 250); out.kickCh = out.kickCh.slice(0, 250); out.flags.kick = !!(out.kick.length || out.kickCh.length); } catch (e) {} })());
  await Promise.all(tasks);
  await Promise.all([
    (async () => { if (!tid) return; try { const j = await get("https://api.betterttv.net/3/cached/users/twitch/" + tid); out.bttvCh = [...(j.channelEmotes || []), ...(j.sharedEmotes || [])].filter(e => e && nameOk(e.code) && /^[a-f0-9]{24}$/.test(e.id)).slice(0, 150).map(e => [e.code, e.id]); } catch (e) {} })(),
    (async () => { if (!tid) return; try { const j = await get("https://7tv.io/v3/users/twitch/" + tid); out.seventvCh = (((j && j.emote_set) || {}).emotes || []).filter(e => e && nameOk(e.name) && /^[A-Za-z0-9]{10,40}$/.test(e.id)).slice(0, 250).map(e => [e.name, e.id]); } catch (e) {} })(),
    (async () => { try { const a = await twitchAuth(); if (!a) return; const H = { "client-id": a.id, authorization: "Bearer " + a.tok };
      const g = await get("https://api.twitch.tv/helix/chat/emotes/global", { headers: H }); out.twitch = (g.data || []).filter(e => e && nameOk(e.name) && e.id).slice(0, 250).map(e => [e.name, String(e.id)]);
      const u = await get("https://api.twitch.tv/helix/users?login=" + encodeURIComponent(TWITCH_LOGIN), { headers: H }); const bid = u.data && u.data[0] && u.data[0].id;
      if (bid) { const c = await get("https://api.twitch.tv/helix/chat/emotes?broadcaster_id=" + bid, { headers: H }); out.twitchCh = (c.data || []).filter(e => e && nameOk(e.name) && e.id).slice(0, 250).map(e => [e.name, String(e.id)]); }
      out.flags.twitchOfficial = true; } catch (e) {} })(),
  ]);
  if (out.bttv.length || out.seventv.length || out.kick.length || out.kickCh.length || out.twitch.length) { cache = out; at = Date.now(); }
  return J(cache || out);
};
