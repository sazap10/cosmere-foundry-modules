// Assemble the installable module folder (build/table-ledger) and, with --zip,
// the release archive. Foundry loads paths relative to the module root, so the
// layout here must match module.json.
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const out = "build/table-ledger";
// Empty the module folder in place rather than deleting it: a dev Foundry may
// bind-mount it, and replacing the directory leaves a stale mount.
mkdirSync(out, { recursive: true });
for (const entry of readdirSync("build")) {
  if (entry !== "table-ledger") rmSync(`build/${entry}`, { recursive: true, force: true });
}
for (const entry of readdirSync(out)) rmSync(`${out}/${entry}`, { recursive: true, force: true });
// Each feature owns lang/parts/<feature>.json; merge them under TABLE_LEDGER.
const lang = { TABLE_LEDGER: { Title: "Table Ledger" } };
for (const file of readdirSync("lang/parts").filter((f) => f.endsWith(".json")).sort()) {
  const part = JSON.parse(readFileSync(`lang/parts/${file}`, "utf8"));
  for (const key of Object.keys(part)) {
    if (key in lang.TABLE_LEDGER) throw new Error(`Duplicate lang key ${key} in ${file}`);
  }
  Object.assign(lang.TABLE_LEDGER, part);
}
mkdirSync(`${out}/lang`, { recursive: true });
writeFileSync(`${out}/lang/en.json`, JSON.stringify(lang, null, 2) + "\n");

for (const entry of ["module.json", "dist", "templates", "styles"]) {
  if (existsSync(entry)) cpSync(entry, `${out}/${entry}`, { recursive: true });
}
if (process.argv.includes("--zip")) {
  execFileSync("zip", ["-qr", "../table-ledger.zip", "."], { cwd: out });
  cpSync("module.json", "build/module.json");
}
console.log(`Packaged ${out}`);
