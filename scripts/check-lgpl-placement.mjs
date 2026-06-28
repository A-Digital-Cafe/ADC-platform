#!/usr/bin/env bun
/**
 * Guard-rail de placement de licencias copyleft (LGPL).
 *
 * Política: las dependencias LGPL solo pueden estar en módulos backend
 * (por defecto: carpetas `services/`). Quedan PROHIBIDAS en cualquier app
 * (módulo que UIFederationService bundlea con rspack hacia el cliente),
 * porque bundlear una librería LGPL = linking estático => dispara copyleft.
 *
 * Qué chequea: el cierre transitivo de dependencias *npm declaradas* de cada
 * workspace first-party. Si una dep LGPL es alcanzable desde un módulo que no
 * está en la zona permitida, falla.
 *
 * Limitación conocida: solo ve dependencias npm declaradas (package.json), no
 * imports vía alias de fuentes compartidas. Aun así cubre el caso realista
 * (`bun add <lib-lgpl>` en una app) y el LGPL actual (sharp/libvips) es nativo
 * y no bundleable. Para garantía dura habría que escanear el bundle generado.
 *
 * Uso: `bun run scripts/check-lgpl-placement.mjs`  (exit 1 si hay violaciones)
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const NM = join(ROOT, "node_modules");
// Zona donde SÍ se permite LGPL (backend, no se bundlea al cliente):
const ALLOWED_ZONES = ["/services/"];
// Zona explícitamente bundleada al cliente por rspack:
const CLIENT_ZONE = "/apps/";

/* ---------- helpers ---------- */
const pkgCache = new Map();
function readInstalledPkg(name) {
  if (pkgCache.has(name)) return pkgCache.get(name);
  const p = join(NM, ...name.split("/"), "package.json");
  let v = null;
  if (existsSync(p)) { try { v = JSON.parse(readFileSync(p, "utf8")); } catch { /* ignore */ } }
  pkgCache.set(name, v);
  return v;
}
function licenseOf(pkg) {
  const l = pkg?.license ?? pkg?.licenses;
  if (!l) return "";
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => x.type || x).join(" ");
  return l.type || "";
}
const isCopyleft = (lic) => /LGPL|AGPL|(^|[^.\w])GPL-/i.test(lic);

/* ---------- 1. set de paquetes LGPL/copyleft en node_modules ---------- */
function collectCopyleft() {
  const found = new Map(); // name -> license
  const walk = (dir, scope = "") => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith("@")) { walk(join(dir, e.name), e.name); continue; }
      const name = scope ? `${scope}/${e.name}` : e.name;
      const pjp = join(dir, e.name, "package.json");
      if (existsSync(pjp)) {
        try {
          const lic = licenseOf(JSON.parse(readFileSync(pjp, "utf8")));
          if (isCopyleft(lic)) found.set(name, lic);
        } catch { /* ignore */ }
      }
      // nested node_modules
      const nested = join(dir, e.name, "node_modules");
      if (existsSync(nested)) walk(nested, "");
    }
  };
  walk(NM);
  return found;
}

/* ---------- 2. cierre transitivo de deps npm ---------- */
function closure(deps) {
  const seen = new Set();
  const stack = [...deps];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    const pj = readInstalledPkg(n);
    if (!pj) continue;
    for (const d of Object.keys(pj.dependencies || {})) if (!seen.has(d)) stack.push(d);
    for (const d of Object.keys(pj.optionalDependencies || {})) if (!seen.has(d)) stack.push(d);
  }
  return seen;
}

/* ---------- 3. workspaces first-party ---------- */
function findWorkspaces() {
  const out = [];
  const roots = ["src", "presets"];
  const skip = new Set(["node_modules", "temp", "dist", ".git"]);
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (existsSync(join(dir, "package.json")) && dir !== ROOT) {
      out.push(dir);
      return; // no anidar workspaces
    }
    for (const e of entries) {
      if (e.isDirectory() && !skip.has(e.name)) walk(join(dir, e.name));
    }
  };
  for (const r of roots) walk(join(ROOT, r));
  return out;
}

/* ---------- main ---------- */
const copyleft = collectCopyleft();
if (copyleft.size === 0) {
  console.log("ℹ️  No se encontraron paquetes LGPL/copyleft instalados. Nada que validar.");
  process.exit(0);
}

const violations = [];
for (const wsDir of findWorkspaces()) {
  const rel = wsDir.replace(ROOT + "/", "/") + "/";
  const allowed = ALLOWED_ZONES.some((z) => rel.includes(z));
  if (allowed) continue;
  const pj = JSON.parse(readFileSync(join(wsDir, "package.json"), "utf8"));
  const reach = closure([
    ...Object.keys(pj.dependencies || {}),
    ...Object.keys(pj.optionalDependencies || {}),
  ]);
  const hits = [...reach].filter((n) => copyleft.has(n));
  if (hits.length) {
    violations.push({
      module: rel.replace(ROOT, ""),
      client: rel.includes(CLIENT_ZONE),
      hits: hits.map((h) => `${h} (${copyleft.get(h)})`),
    });
  }
}

console.log(`🔎 LGPL/copyleft instalados: ${copyleft.size} paquete(s).`);
console.log(`   Zona permitida: ${ALLOWED_ZONES.join(", ")}\n`);

if (violations.length === 0) {
  console.log("✅ Ninguna dep LGPL alcanzable desde módulos fuera de la zona permitida.");
  process.exit(0);
}

console.error("❌ Dependencias LGPL/copyleft fuera de la zona permitida:\n");
for (const v of violations) {
  console.error(`  ${v.client ? "🌐 [CLIENTE/rspack] " : ""}${v.module}`);
  for (const h of v.hits) console.error(`      └─ ${h}`);
}
console.error("\nMové la dependencia a un módulo de services/, o ajustá ALLOWED_ZONES si corresponde.");
process.exit(1);
