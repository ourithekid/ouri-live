import { getStore } from "@netlify/blobs";
import { ddGet, sfxList, sfxQueue, sfxVol } from "./ovlib.mjs";
export const config = { path: "/api/overlay" };
// One link for the stream app (Moblin, IRL Pro, Streamlabs...): shows the DoorDash total and plays the sounds viewers buy on the site.
//   https://streamgrind.com/api/overlay            (options: ?dd=0  ?sfx=0  ?ddpos=tl|tr|bl|br  ?sfxpos=tc|bc  ?scale=1.2  ?v=0.8)
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const pub = () => getStore({ name: "ouri", consistency: "strong" });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ouri overlay</title>
<style>
html,body{margin:0;background:transparent!important;overflow:hidden;font-family:"Chakra Petch","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
#dd{position:fixed;display:none;align-items:center;gap:.7em;padding:.55em 1em .55em .7em;border-radius:1em;background:rgba(10,12,14,.82);border:.12em solid #ff3008;color:#fff;box-shadow:0 .4em 1.4em rgba(0,0,0,.5);font-size:22px;line-height:1}
#dd .ic{width:2.1em;height:2.1em;border-radius:50%;background:#ff3008;display:grid;place-items:center;font-weight:900;font-size:.9em}
#dd .tx{display:flex;flex-direction:column;gap:.25em}
#dd small{font-size:.5em;letter-spacing:.18em;font-weight:800;color:#ff8a73;text-transform:uppercase}
#dd b{font-size:1.5em;font-weight:900;letter-spacing:.01em}
#dd .ord{display:flex;flex-direction:column;align-items:center;gap:.15em;margin-left:.2em;padding:.35em .8em;border-radius:.8em;background:rgba(255,48,8,.2);border:.08em solid rgba(255,48,8,.65)}
#dd .ord b{font-size:1.25em;line-height:1}
#dd .ord small{font-size:.42em;letter-spacing:.16em;color:#ffb3a3}
#dd .plus{position:absolute;right:.6em;top:-1em;color:#7dff8b;font-weight:900;font-size:.9em;opacity:0;text-shadow:0 .1em .4em #000}
#dd.pop{animation:pop .7s ease}#dd.pop .plus{animation:plus 1.6s ease forwards}
@keyframes pop{0%{transform:scale(1)}30%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes plus{0%{opacity:0;transform:translateY(.5em)}20%{opacity:1}100%{opacity:0;transform:translateY(-1.4em)}}
#sf{position:fixed;display:none;align-items:center;gap:.7em;padding:.6em 1.1em;border-radius:999px;background:rgba(10,12,14,.85);border:.1em solid #53fc18;color:#fff;font-size:20px;box-shadow:0 .4em 1.4em rgba(0,0,0,.5);max-width:90vw;white-space:nowrap}
#sf.show{display:flex;animation:in .35s ease}
#sf .sp{font-size:1.3em}#sf b{font-weight:800}#sf span.by{opacity:.75;font-size:.85em}
@keyframes in{from{opacity:0;transform:translateY(.8em) scale(.96)}to{opacity:1;transform:none}}
#hint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:none;padding:.8em 1.2em;border-radius:.8em;background:#222;color:#fff;font-size:18px;border:1px solid #666;text-align:center}
</style></head><body>
<div id="dd"><div class="ic">DD</div><div class="tx"><small>DoorDash today</small><b id="ddT">$0.00</b></div><div class="ord"><b id="ddN">0</b><small id="ddL">ORDERS</small></div><span class="plus" id="ddP"></span></div>
<div id="sf"><span class="sp">🔊</span><b id="sfN"></b><span class="by" id="sfB"></span></div>
<div id="hint">Sound is blocked here. Tap once to turn it on.</div>
<script>
(function(){
var Q=new URLSearchParams(location.search),DD=Q.get("dd")!=="0",SFX=Q.get("sfx")!=="0",VOL=Math.max(0,Math.min(1,parseFloat(Q.get("v")||"1")||1)),SC=Math.max(.4,Math.min(3,parseFloat(Q.get("scale")||"1")||1));
document.documentElement.style.zoom=SC;
function place(el,pos,def){pos=pos||def;el.style.top=el.style.bottom=el.style.left=el.style.right="auto";var m="16px";
 if(pos==="tl"){el.style.top=m;el.style.left=m}else if(pos==="tr"){el.style.top=m;el.style.right=m}else if(pos==="bl"){el.style.bottom=m;el.style.left=m}else if(pos==="br"){el.style.bottom=m;el.style.right=m}
 else if(pos==="tc"){el.style.top=m;el.style.left="50%";el.style.transform="translateX(-50%)"}else{el.style.bottom=m;el.style.left="50%";el.style.transform="translateX(-50%)"}}
var dd=document.getElementById("dd"),sf=document.getElementById("sf");place(dd,Q.get("ddpos"),"tl");place(sf,Q.get("sfxpos"),"bc");
var AC=null,since=null,queue=[],busy=false,lastC=null,GV=1,MG=null;
function master(c){if(!MG||MG.context!==c){MG=c.createGain();var cp=c.createDynamicsCompressor();MG.connect(cp);cp.connect(c.destination)}MG.gain.value=VOL*GV;return MG}
function ctx(){if(!AC){try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==="suspended")AC.resume();return AC}
document.addEventListener("pointerdown",function(){ctx();document.getElementById("hint").style.display="none"});
/* ---- built-in preset sounds, synthesized (no files) ---- */
function env(g,t,a,d,pk,end){g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(pk,t+a);g.gain.exponentialRampToValueAtTime(0.0001,t+a+d)}
function tone(c,f,t,d,type,pk,f2){var o=c.createOscillator(),g=c.createGain();o.type=type||"sine";o.frequency.setValueAtTime(f,t);if(f2)o.frequency.exponentialRampToValueAtTime(f2,t+d);env(g,t,.01,d,(pk||.4));o.connect(g);g.connect(master(c));o.start(t);o.stop(t+d+.05)}
function noise(c,t,d,pk,hp){var n=c.sampleRate*d,b=c.createBuffer(1,n,c.sampleRate),a=b.getChannelData(0);for(var i=0;i<n;i++)a[i]=Math.random()*2-1;var s=c.createBufferSource();s.buffer=b;var g=c.createGain(),f=c.createBiquadFilter();f.type="highpass";f.frequency.value=hp||800;env(g,t,.005,d,(pk||.4));s.connect(f);f.connect(g);g.connect(master(c));s.start(t)}
var SYN={
"p-airhorn":function(c,t){[0,.02].forEach(function(o){tone(c,466,t+o,1.1,"sawtooth",.28);tone(c,587,t+o,1.1,"sawtooth",.22);tone(c,698,t+o,1.1,"sawtooth",.18)})},
"p-ding":function(c,t){tone(c,1318,t,1.4,"sine",.5);tone(c,2637,t,.9,"sine",.15)},
"p-rimshot":function(c,t){noise(c,t,.12,.5,300);tone(c,180,t,.12,"sine",.5,60);noise(c,t+.2,.1,.4,300);tone(c,180,t+.2,.1,"sine",.5,60);noise(c,t+.5,.7,.5,3000)},
"p-trombone":function(c,t){[[311,0,.5],[294,.55,.5],[277,1.1,.5],[262,1.65,1.1]].forEach(function(n){tone(c,n[0],t+n[1],n[2],"sawtooth",.28,n[0]*(n[1]>1.6?.82:.97))})},
"p-laser":function(c,t){tone(c,1800,t,.35,"square",.25,150)},
"p-coin":function(c,t){tone(c,988,t,.09,"square",.25);tone(c,1319,t+.09,.5,"square",.25)},
"p-buzzer":function(c,t){tone(c,120,t,.7,"sawtooth",.45);tone(c,127,t,.7,"square",.25)},
"p-siren":function(c,t){for(var i=0;i<3;i++){tone(c,650,t+i*.6,.3,"sawtooth",.28,950);tone(c,950,t+i*.6+.3,.3,"sawtooth",.28,650)}}};
function show(ev){document.getElementById("sfN").textContent=ev.name;document.getElementById("sfB").textContent=ev.by?"from "+ev.by:"";sf.classList.add("show")}
function done(){sf.classList.remove("show");setTimeout(function(){busy=false;next()},350)}
function next(){if(busy||!queue.length)return;busy=true;var ev=queue.shift();if(SFX)show(ev);var fin=false,end=function(){if(fin)return;fin=true;done()};setTimeout(end,12000);
 if(SYN[ev.id]){var c=ctx();if(!c){document.getElementById("hint").style.display="block";return setTimeout(end,1500)}if(c.state!=="running")document.getElementById("hint").style.display="block";SYN[ev.id](c,c.currentTime+.05);setTimeout(end,2300);return}
 var a=new Audio("/api/overlay?sfx="+encodeURIComponent(ev.id));a.volume=1;var c2=ctx();if(c2){try{c2.createMediaElementSource(a).connect(master(c2))}catch(e){a.volume=Math.min(1,VOL*GV)}}else a.volume=Math.min(1,VOL*GV);a.onended=function(){setTimeout(end,300)};a.onerror=end;var p=a.play();if(p&&p.catch)p.catch(function(){document.getElementById("hint").style.display="block";setTimeout(end,1500)})}
function money(c){return "$"+(c/100).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}
function paintDD(d){if(!DD)return;dd.style.display="flex";document.getElementById("ddT").textContent=money(d.c);document.getElementById("ddN").textContent=d.n;document.getElementById("ddL").textContent=d.n===1?"ORDER":"ORDERS";
 if(lastC!==null&&d.c!==lastC){var df=d.c-lastC;document.getElementById("ddP").textContent=(df>0?"+":"-")+money(Math.abs(df));dd.classList.remove("pop");void dd.offsetWidth;dd.classList.add("pop")}lastC=d.c}
function poll(){fetch("/api/overlay?state=1&since="+(since==null?"":since),{cache:"no-store"}).then(function(r){return r.json()}).then(function(j){if(!j||!j.ok)return;GV=Math.max(0,Math.min(2,(j.vol==null?100:Number(j.vol))/100));if(MG)MG.gain.value=VOL*GV;paintDD(j.dd);
 if(since==null){since=j.seq}else{(j.ev||[]).forEach(function(e){if(e.seq>since){since=e.seq;if(SFX)queue.push(e)}});next()}}).catch(function(){})}
poll();setInterval(poll,1500);
})();
</script></body></html>`;

export default async (req) => {
  const q = new URL(req.url).searchParams;
  if (q.has("state")) { const [d, sq, vol] = await Promise.all([ddGet(), sfxQueue(), sfxVol()]); const since = Number(q.get("since")) || 0; return J({ ok: true, vol, dd: { c: d.c, n: d.n, day: d.day }, seq: sq.seq || 0, ev: (sq.ev || []).filter(e => e.seq > since) }); }
  if (q.has("list")) return J({ ok: true, sounds: await sfxList() });
  if (q.has("sfx")) {
    const id = String(q.get("sfx") || ""); if (!/^[a-z0-9]{6,24}$/.test(id)) return new Response("not found", { status: 404 });
    const r = await pub().get("sfx/" + id, { type: "json" }); if (!r || !r.data) return new Response("not found", { status: 404 });
    return new Response(Buffer.from(r.data, "base64"), { headers: { "content-type": r.mime || "audio/mpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
  }
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
};
