#!/usr/bin/env node
/**
 * Copies a brand repository's content, assets and tokens into this engine.
 *
 * The engine holds no brand values of its own. Everything specific to a brand arrives
 * here, which is what lets one engine serve Inspectas, Working Detail and anything else
 * without a fork.
 *
 *   BRAND_REPO=../inspectas-brand node scripts/sync-brand.mjs
 *
 * Defaults to ../inspectas-brand when BRAND_REPO isn't set.
 */
import fs from "node:fs";
import path from "node:path";

const ENGINE = path.join(import.meta.dirname, "..");
const BRAND = path.resolve(ENGINE, process.env.BRAND_REPO ?? "../inspectas-brand");

const DOCS = path.join(ENGINE, "src", "content", "docs");
const PUBLIC_ASSETS = path.join(ENGINE, "public", "assets");
const BRAND_DATA = path.join(ENGINE, "src", "brand");

const fail = (message) => {
  console.error(`\nsync-brand: ${message}\n`);
  process.exit(1);
};

if (!fs.existsSync(BRAND)) fail(`no brand repo at ${BRAND}. Set BRAND_REPO to its path.`);

const configPath = path.join(BRAND, "brand.config.json");
if (!fs.existsSync(configPath)) fail(`${BRAND} has no brand.config.json — is it a brand repo?`);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// The engine must not know a brand's folder names. The brand declares them; anything the
// engine hardcodes stops it being reusable the moment a brand renames something.
const assetFiles = config.paths?.assetFiles;
const assetManifest = config.paths?.assetManifest;
if (!assetFiles || !assetManifest) {
  fail("brand.config.json needs paths.assetFiles and paths.assetManifest — the engine no longer assumes folder names.");
}

/* Tokens must be built before the site can be styled. Say so plainly rather than
   rendering an unstyled site and leaving someone to work out why. */
const tokensCss = path.join(BRAND, "dist", "tokens.css");
if (!fs.existsSync(tokensCss)) {
  fail(`${config.name} has no dist/tokens.css — run "npm run build" in the brand repo first.`);
}

/* ------------------------------------------------------------------ *
 * Component imports.
 *
 * Brand content is written by people editing markdown in GitHub's web editor, so it uses
 * bare component tags — <ColourTable />, not an import statement they'd have to remember.
 * The imports are injected here instead, at sync time, based on which tags a page actually
 * uses. Content stays readable; MDX still gets what it needs.
 * ------------------------------------------------------------------ */
const COMPONENTS = [
  "ColourTable",
  "TypeSpecimen",
  "TypeScale",
  "AssetGrid",
  "DownloadButton",
  "SiteCards",
];

const injectImports = (file) => {
  const source = fs.readFileSync(file, "utf8");
  const used = COMPONENTS.filter((name) => new RegExp(`<${name}[\\s/>]`).test(source));
  if (!used.length) return;

  const imports = used.map((name) => `import ${name} from "@components/${name}.astro";`).join("\n");

  // Imports must land after the frontmatter block, not before it.
  const fm = source.match(/^---\n[\s\S]*?\n---\n/);
  const output = fm
    ? `${fm[0]}\n${imports}\n${source.slice(fm[0].length)}`
    : `${imports}\n\n${source}`;

  fs.writeFileSync(file, output);
};

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
};

/* ---------- content ---------- */
fs.rmSync(DOCS, { recursive: true, force: true });
fs.mkdirSync(DOCS, { recursive: true });

let pages = 0;
let injected = 0;
const processPages = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) processPages(full);
    else if (/\.mdx$/.test(entry.name)) {
      pages++;
      const before = fs.readFileSync(full, "utf8");
      injectImports(full);
      if (fs.readFileSync(full, "utf8") !== before) injected++;
    } else if (/\.md$/.test(entry.name)) {
      pages++;
    }
  }
};

for (const section of config.sections) {
  /* A section is either a folder to autogenerate from, or a single standalone page that
     lives at the brand repo's root. Root pages are copied by the loop below this one, so
     a link section needs checking here but nothing copying. */
  if (!section.dir) {
    if (!section.link) {
      fail(`brand.config.json has a section with neither "dir" nor "link": ${JSON.stringify(section)}`);
    }
    const page = ["md", "mdx"].map((ext) => path.join(BRAND, `${section.link}.${ext}`)).find((f) => fs.existsSync(f));
    if (!page) {
      fail(`brand.config.json links section "${section.link}" but there is no ${section.link}.md or .mdx at the root of the brand repo.`);
    }
    continue;
  }

  const from = path.join(BRAND, section.dir);
  if (!fs.existsSync(from)) fail(`brand.config.json lists section "${section.dir}" but that folder doesn't exist.`);
  // The assets section holds binaries alongside its pages; those go to public/, not into
  // the docs collection.
  const to = path.join(DOCS, section.dir);
  copyDir(from, to);
  fs.rmSync(path.join(to, "files"), { recursive: true, force: true });
  processPages(to);
}

/* Root-level pages: the homepage and anything numbered above the sections. */
for (const entry of fs.readdirSync(BRAND, { withFileTypes: true })) {
  if (entry.isFile() && /\.mdx?$/.test(entry.name) && !/^(README|INSTRUCTIONS|CONTRIBUTING)\./i.test(entry.name)) {
    const dest = path.join(DOCS, entry.name);
    fs.copyFileSync(path.join(BRAND, entry.name), dest);
    if (/\.mdx$/.test(entry.name)) injectImports(dest);
    pages++;
  }
}

/* ---------- assets ---------- */
fs.rmSync(PUBLIC_ASSETS, { recursive: true, force: true });
copyDir(path.join(BRAND, assetFiles), PUBLIC_ASSETS);

/* ---------- server configuration ---------- */
/* A brand may ship its own deploy/.htaccess — auth and caching are properties of how a
   particular hub is served, not of the engine. Without one, the site deploys unprotected,
   which is worth saying out loud rather than discovering later. */
const htaccess = path.join(BRAND, "deploy", ".htaccess");
if (fs.existsSync(htaccess)) {
  fs.mkdirSync(path.join(ENGINE, "public"), { recursive: true });
  fs.copyFileSync(htaccess, path.join(ENGINE, "public", ".htaccess"));
} else {
  console.warn("  note: no deploy/.htaccess in the brand repo — the site will deploy with no access control.");
}

/* ---------- data the components read ---------- */
fs.mkdirSync(BRAND_DATA, { recursive: true });
fs.copyFileSync(configPath, path.join(BRAND_DATA, "brand.config.json"));
fs.copyFileSync(path.join(BRAND, assetManifest), path.join(BRAND_DATA, "assets.json"));
fs.copyFileSync(path.join(BRAND, "dist", "tokens.json"), path.join(BRAND_DATA, "tokens.json"));
fs.copyFileSync(tokensCss, path.join(ENGINE, "src", "styles", "tokens.css"));

const assetCount = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? assetCount(path.join(dir, e.name)) : 1),
    0
  );

console.log(
  `synced ${config.name} — ${pages} pages (${injected} with components), ` +
    `${assetCount(PUBLIC_ASSETS)} assets, tokens and config`
);
