import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["dev", "data", "node_modules", ".fused", ".git"]);
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  if (statSync(p).isDirectory()) return skip.has(n) && d === root ? [] : walk(p);
  return p.endsWith(".js") ? [p] : [];
});

const imports = {};
const bad = [];
for (const p of walk(root).sort()) {
  const rel = relative(root, p);
  let key;
  if (rel === "vendor/three.module.js") key = "three";
  else if (rel.startsWith("vendor/three-addons/")) key = "three/addons/" + rel.slice("vendor/three-addons/".length);
  else if (rel.startsWith("vendor/")) key = rel.slice(7, -3);
  else key = "@/" + rel;
  imports[key] = rel;
  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) bad.push(`${rel}: relative import ${m[1]}`);
}
writeFileSync(join(root, "modules.json"), JSON.stringify({ imports }, null, 1) + "\n");
console.log(`modules.json: ${Object.keys(imports).length} modules`);
if (bad.length) { console.error("Relative imports do not work under /api/fs/raw. Use bare specifiers such as \"@/core/x.js\":\n" + bad.join("\n")); process.exit(1); }
