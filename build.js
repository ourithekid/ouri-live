// Builds the Cloudflare Pages output: dist/_worker.js (all /api functions in one file) + the static site.
// Run by Cloudflare on every push:  node cloudflare/build.mjs
import { build } from "esbuild";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, ".."), fnDir = path.join(root, "netlify", "functions"), dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });
// 1) route table from every function file
const files = fs.readdirSync(fnDir).filter(f => f.endsWith(".mjs")).sort();
let gen = files.map((f, i) => `import * as m${i} from "../netlify/functions/${f}";`).join("\n") + "\nconst T = [" + files.map((f, i) => `m${i}`).join(", ") + "];\nconst R = [];\nfor (const m of T) { if (!m.config || !m.default) continue; for (const p of [].concat(m.config.path)) R.push([p, m.default]); }\nexport const route = u => { for (const [p, h] of R) { if (p.endsWith(\"/*\") ? (u === p.slice(0, -2) || u.startsWith(p.slice(0, -1))) : u === p) return h; } return null; };\n";
fs.writeFileSync(path.join(here, ".routes.mjs"), gen);
// 2) bundle
const ITER = 50000;
const swapScrypt = { name: "swap-scrypt", setup(b) {
  b.onLoad({ filter: /[\\/]auth\.mjs$/ }, args => { let s = fs.readFileSync(args.path, "utf8"); const re = /const scr = \(pw, salt\) => new Promise\([^\n]*\n/; if (!re.test(s)) throw new Error("auth.mjs: scrypt line not found");
    s = s.replace(re, `const scr = async (pw, salt) => { const enc = new TextEncoder(), key = await globalThis.crypto.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"]); const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(String(salt)), iterations: ${ITER} }, key, 512); return Buffer.from(bits).toString("hex"); };\n`);
    return { contents: s, loader: "js" }; }); } };
await build({ entryPoints: [path.join(here, "worker.mjs")], outfile: path.join(dist, "_worker.js"), bundle: true, format: "esm", platform: "neutral", mainFields: ["module", "main"], conditions: ["workerd", "worker", "browser"], target: "es2022", external: ["node:*"], alias: { "@netlify/blobs": path.join(here, "blobs.mjs") }, plugins: [swapScrypt], logLevel: "info" });
// 3) static files
const skip = new Set(["netlify", "cloudflare", "dist", "node_modules", "netlify.toml", "package.json", "package-lock.json", "wrangler.toml", ".git", ".github", ".gitignore"]);
for (const f of fs.readdirSync(root)) { if (skip.has(f) || f.startsWith(".")) continue; const p = path.join(root, f); if (fs.statSync(p).isFile()) fs.copyFileSync(p, path.join(dist, f)); }
// 4) security headers (same as netlify.toml) + only send /api/* to the worker
const toml = fs.existsSync(path.join(root, "netlify.toml")) ? fs.readFileSync(path.join(root, "netlify.toml"), "utf8") : "";
let hdr = ""; for (const blk of toml.split("[[headers]]").slice(1)) { const m = /for\s*=\s*"([^"]+)"/.exec(blk); if (!m) continue; hdr += m[1] + "\n"; for (const l of blk.split("\n")) { const k = /^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/.exec(l); if (k && k[1] !== "for") hdr += "  " + k[1] + ": " + k[2].replace(/\\"/g, '"') + "\n"; } }
fs.writeFileSync(path.join(dist, "_headers"), hdr);
fs.writeFileSync(path.join(dist, "_routes.json"), JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }));
console.log("built", files.length, "functions ->", dist);
