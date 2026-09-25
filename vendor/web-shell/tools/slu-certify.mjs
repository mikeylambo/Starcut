#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const profile = process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? "release";
const jsonMode = process.argv.includes("--json");
const packagePath = path.join(root, "package.json");
const configPath = path.join(root, "slu-certification.json");

const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
const pkg = readJson(packagePath, null);
if (!pkg) {
  console.error("SLU certification: package.json not found");
  process.exit(2);
}

const config = readJson(configPath, {
  schemaVersion: 1,
  requiredFiles: ["src/main.ts", "index.html"],
  requiredScripts: ["build", "check"],
  declarations: [],
  forbiddenSourceTokens: ["TODO_PLAYER", "PLACEHOLDER_PLAYER", "LOREM_IPSUM"],
  profiles: {}
});

const selected = config.profiles?.[profile] ?? {};
const requiredFiles = [...new Set([...(config.requiredFiles ?? []), ...(selected.requiredFiles ?? [])])];
const requiredScripts = [...new Set([...(config.requiredScripts ?? []), ...(selected.requiredScripts ?? [])])];
const requiredDeclarations = [...new Set(selected.requiredDeclarations ?? [])];
const declarations = new Set(config.declarations ?? []);
const forbiddenTokens = [...new Set([...(config.forbiddenSourceTokens ?? []), ...(selected.forbiddenSourceTokens ?? [])])];
const requiredJsonFields = {...(config.requiredJsonFields??{}),...(selected.requiredJsonFields??{})};
const results = [];

function record(name, ok, message = "") {
  results.push({ name, ok, message });
}

for (const file of requiredFiles) {
  record(`file:${file}`, fs.existsSync(path.join(root, file)), `required file ${file}`);
}
for (const script of requiredScripts) {
  record(`script:${script}`, Boolean(pkg.scripts?.[script]), `required npm script ${script}`);
}
for (const declaration of requiredDeclarations) {
  record(`capability:${declaration}`, declarations.has(declaration), `declare capability '${declaration}' in slu-certification.json`);
}
for(const [relative,fields] of Object.entries(requiredJsonFields)){
  const absolute=path.join(root,relative);
  if(!fs.existsSync(absolute)){record(`json:${relative}`,false,`required JSON file ${relative}`);continue;}
  let data=null;
  try{data=JSON.parse(fs.readFileSync(absolute,"utf8"));record(`json:${relative}`,true,"valid JSON");}
  catch(error){record(`json:${relative}`,false,error instanceof Error?error.message:String(error));continue;}
  for(const field of fields??[]){
    const value=String(field).split(".").reduce((current,key)=>current?.[key],data);
    const present=value!==undefined&&value!==null&&value!=="";
    record(`json-field:${relative}:${field}`,present,`required JSON field ${field}`);
  }
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:ts|tsx|js|mjs|jsx|html|css|json|md)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const sourceFiles = walk(path.join(root, "src"));
for (const token of forbiddenTokens) {
  const offenders = sourceFiles.filter(file => fs.readFileSync(file, "utf8").includes(token));
  record(`forbidden:${token}`, offenders.length === 0, offenders.length ? offenders.map(file => path.relative(root, file)).join(", ") : "");
}

if (config.maxSourceFileBytes) {
  for (const [file, limit] of Object.entries(config.maxSourceFileBytes)) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) continue;
    const size = fs.statSync(absolute).size;
    record(`size:${file}`, size <= limit, `${size} / ${limit} bytes`);
  }
}

const ok = results.every(result => result.ok);
const report = {
  schemaVersion: 1,
  profile,
  project: pkg.name,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  ok,
  results
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`SLU CERTIFY // ${profile.toUpperCase()} // ${pkg.name}`);
  for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}${result.message ? ` — ${result.message}` : ""}`);
  console.log(ok ? "CERTIFIED" : "CERTIFICATION FAILED");
}

process.exit(ok ? 0 : 1);
