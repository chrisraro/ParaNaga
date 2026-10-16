import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const catalog = await readJson("src/domain/media/catalog.json");
const rights = await readJson("src/domain/sources/rights-catalog.json");
const seed = await readJson("Data_Sets/naga_transport_seed.json");
const modes = await readJson("data/source/research/naga-modes-seed-2026-10-16.json");
const software = await readJson("data/software-license-inventory.json");
const errors = [];
if (JSON.stringify(await readJson("public/media/places/CREDITS.json")) !== JSON.stringify(catalog)) errors.push("Public photo attribution manifest is stale");
const ids = new Set();
for (const photo of catalog.assets) {
  if (ids.has(photo.id)) errors.push(`Duplicate photo identity: ${photo.id}`);
  ids.add(photo.id);
  if (!photo.creator || !photo.title || !photo.capturedAt || !photo.modifications || !photo.license || !photo.licenseUrl) errors.push(`${photo.id}: incomplete credits`);
  if (!/^CC BY(?:-SA)? [34]\.0$|^CC0$|^Public domain$/.test(photo.license)) errors.push(`${photo.id}: license requires separate review`);
  if (photo.jevDecision !== "act" && photo.humanApproval?.decision !== "approved") errors.push(`${photo.id}: unresolved Jev decision without human approval`);
  if (!photo.sourceUrl.startsWith("https://commons.wikimedia.org/wiki/File:")) errors.push(`${photo.id}: unsupported source`);
  if (!/^\/media\/places\/photo-[a-f0-9]{12}\.webp$/.test(photo.src)) { errors.push(`${photo.id}: invalid asset path`); continue; }
  try {
    const data = await readFile(resolve(`public${photo.src}`));
    if (createHash("sha256").update(data).digest("hex") !== photo.sha256) errors.push(`${photo.id}: file changed without renewed provenance`);
  } catch { errors.push(`${photo.id}: missing file`); }
}
for (const [key, id] of Object.entries(catalog.links)) if (!ids.has(id)) errors.push(`${key}: missing linked asset`);
for (const file of await readdir("public/media/places")) if (file.endsWith(".webp") && !catalog.assets.some((p) => p.src.endsWith(`/${file}`))) errors.push(`Uncredited shipped photo: ${file}`);
const codes = rights.map((r) => r.code);
if (new Set(codes).size !== codes.length) errors.push("Duplicate source codes");
for (const code of [...seed.sources.map((s) => s.id), ...modes.sources.map((s) => s.code)]) if (!codes.includes(code)) errors.push(`Missing source rights record: ${code}`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
const blockers = rights.filter((r) => r.status === "permission_required" || r.status === "reuse_unconfirmed").map((r) => `${r.code}: ${r.license}`);
blockers.push(...software.filter((p) => p.license === "NOT RECORDED").map((p) => `${p.package}: exact-version license not established`));
console.log(`Credits integrity OK: ${catalog.assets.length} photos, ${rights.length} data/research sources, ${software.length} installed locked packages.`);
if (blockers.length) console.log(`Unresolved release rights (${blockers.length}):\n${blockers.join("\n")}`);
if (process.argv.includes("--release") && blockers.length) { console.error("Release rights gate FAILED. Record verifiable permission or replace the affected source; credits alone do not clear rights."); process.exit(1); }
