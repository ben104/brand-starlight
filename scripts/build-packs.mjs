#!/usr/bin/env node
/**
 * Builds the downloadable AI context packs into public/downloads/.
 *
 * Must run BEFORE `astro build`, because Astro copies public/ into dist/ as part of the
 * build. Running it after produces packs that never reach the published site.
 *
 * Three tiers, because the right answer depends on whether the tool can reach the web:
 *   brand-hub-complete.md  every guideline in one file — for pasting into a chat
 *   brand-docs.zip         the markdown, in folders — for tools with repo access
 *   brand-context.zip      docs plus every asset — for offline tools only
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ENGINE = path.join(import.meta.dirname, "..");
const BRAND = path.resolve(ENGINE, process.env.BRAND_REPO ?? "../inspectas-brand");
const OUT = path.join(ENGINE, "public", "downloads");
const STAGE = path.join(ENGINE, ".packs");

const config = JSON.parse(fs.readFileSync(path.join(BRAND, "brand.config.json"), "utf8"));

fs.rmSync(OUT, { recursive: true, force: true });
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copyDir = (from, to, filter = () => true) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else if (filter(src)) fs.copyFileSync(src, dst);
  }
};

const isDoc = (file) => /\.mdx?$/.test(file);

/* ---------- 1. one markdown file ---------- */
const collectDocs = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "files" && !entry.name.startsWith(".")) collectDocs(full, out);
    } else if (isDoc(entry.name)) out.push(full);
  }
  return out;
};

const docs = [];
for (const section of config.sections) collectDocs(path.join(BRAND, section.dir), docs);
for (const entry of fs.readdirSync(BRAND)) {
  if (isDoc(entry) && !/^(README|INSTRUCTIONS|CONTRIBUTING)\./i.test(entry)) {
    docs.push(path.join(BRAND, entry));
  }
}

const tokens = JSON.parse(fs.readFileSync(path.join(BRAND, "dist", "tokens.json"), "utf8"));

let combined = `# ${config.name} — brand guidelines

> ${config.tagline}

Generated from the brand source of truth on ${new Date().toLocaleDateString("en-GB")}.
The current version is always at ${config.site}.

---

## Design tokens

Every brand value, machine-readable. These are the authoritative colours, type and spacing —
if anything later in this document disagrees with this section, this section is correct.

\`\`\`json
${JSON.stringify(tokens, null, 2)}
\`\`\`

---

`;

for (const doc of docs) {
  const raw = fs.readFileSync(doc, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const title = fm?.[1].match(/^title:\s*(.+)$/m)?.[1].replace(/^["']|["']$/g, "") ?? path.basename(doc);
  let body = fm ? raw.slice(fm[0].length) : raw;
  // Component tags and their injected imports mean nothing outside the site.
  body = body.replace(/^import .+ from ".+";$/gm, "").replace(/<\/?[A-Z][\w]*[^>]*>/g, "").trim();
  // Each page's title becomes an h2 here, so demote the page's own headings by one level.
  // Without this every section in the file sits at the same depth and the structure is lost
  // on anything reading it — which is the entire audience for this file.
  body = body.replace(/^(#{1,5}) /gm, (_, hashes) => `${hashes}# `);
  combined += `## ${title}\n\n_Source: ${path.relative(BRAND, doc)}_\n\n${body}\n\n---\n\n`;
}

fs.writeFileSync(path.join(OUT, "brand-hub-complete.md"), combined);

/* ---------- 2. docs pack ---------- */
const docsStage = path.join(STAGE, "brand-docs");
for (const section of config.sections) {
  copyDir(path.join(BRAND, section.dir), path.join(docsStage, section.dir), isDoc);
}
fs.rmSync(path.join(docsStage, "03-assets", "files"), { recursive: true, force: true });
fs.copyFileSync(path.join(OUT, "brand-hub-complete.md"), path.join(docsStage, "brand-hub-complete.md"));
fs.copyFileSync(path.join(BRAND, "dist", "tokens.json"), path.join(docsStage, "tokens.json"));
fs.copyFileSync(path.join(BRAND, "03-assets", "assets.json"), path.join(docsStage, "assets.json"));
if (fs.existsSync(path.join(BRAND, "INSTRUCTIONS.md"))) {
  fs.copyFileSync(path.join(BRAND, "INSTRUCTIONS.md"), path.join(docsStage, "INSTRUCTIONS.md"));
}

/* ---------- 3. full context pack ---------- */
const fullStage = path.join(STAGE, "brand-context");
copyDir(docsStage, fullStage);
copyDir(path.join(BRAND, "03-assets", "files"), path.join(fullStage, "assets"));

const zip = (stageDir, name) => {
  execFileSync("zip", ["-r", "-q", "-X", path.join(OUT, name), path.basename(stageDir)], {
    cwd: path.dirname(stageDir),
  });
};

zip(docsStage, "brand-docs.zip");

// The full context pack is large — every logo, illustration and the brochure. It exists for
// AI tools that cannot reach the web. A brand can opt out in brand.config.json if the
// deploy weight isn't worth it.
if (config.packs?.fullContext !== false) {
  zip(fullStage, "brand-context.zip");
}

fs.rmSync(STAGE, { recursive: true, force: true });

const kb = (file) => `${Math.round(fs.statSync(path.join(OUT, file)).size / 1024)} KB`;
const mb = (file) => `${(fs.statSync(path.join(OUT, file)).size / 1024 / 1024).toFixed(1)} MB`;

const parts = [`complete.md ${kb("brand-hub-complete.md")}`, `docs.zip ${kb("brand-docs.zip")}`];
if (fs.existsSync(path.join(OUT, "brand-context.zip"))) {
  parts.push(`context.zip ${mb("brand-context.zip")}`);
}
console.log(`packs built — ${parts.join(", ")}`);
