#!/usr/bin/env node
/**
 * Emits a downloadable Markdown rendition of every page into public/raw/.
 *
 * Must run BEFORE `astro build`, because Astro copies public/ into dist/.
 *
 * The point is that the raw source is not good enough on its own: pages like Colours are
 * mostly `<ColourTable />`, which means nothing outside the site. So each component is
 * replaced with Markdown generated from the same tokens and manifest the component renders
 * from — the download carries the actual data, not a placeholder.
 */
import fs from "node:fs";
import path from "node:path";

const ENGINE = path.join(import.meta.dirname, "..");
const DOCS = path.join(ENGINE, "src", "content", "docs");
const OUT = path.join(ENGINE, "public", "raw");
const BRAND = path.join(ENGINE, "src", "brand");

const tokens = JSON.parse(fs.readFileSync(path.join(BRAND, "tokens.json"), "utf8"));
const assets = JSON.parse(fs.readFileSync(path.join(BRAND, "assets.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(BRAND, "brand.config.json"), "utf8"));

const overrides = config.labels ?? {};
const label = (s) => overrides[s] ?? String(s).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/* ---------- component → markdown ---------- */

const colourRows = (entries) =>
  ["| Name | Hex | CSS custom property |", "|---|---|---|",
   ...entries.map(([name, hex, cssVar]) => `| ${name} | \`${hex}\` | \`var(${cssVar})\` |`)].join("\n");

const colourTable = (attrs) => {
  const set = /set=["']divisions["']/.test(attrs) ? "divisions" : "core";
  if (set === "core") {
    const core = Object.entries(tokens.color.core).map(([n, hex]) => [label(n), hex, `--color-core-${n}`]);
    const ramp = Object.entries(tokens.color.ramp).flatMap(([hue, tones]) =>
      Object.entries(tones).map(([tone, hex]) => [`${label(hue)} ${tone}`, hex, `--color-ramp-${hue}-${tone}`]));
    return `### Core\n\n${colourRows(core)}\n\n### Hue ramps\n\n${colourRows(ramp)}`;
  }
  return Object.entries(tokens.color.division).map(([slug, tones]) => {
    const rows = Object.entries(tones).map(([tone, hex]) => [label(tone), hex, `--color-division-${slug}-${tone}`]);
    return `### ${label(slug)}\n\n${colourRows(rows)}`;
  }).join("\n\n");
};

const weightName = (w) => ({ 400: "Regular", 500: "Medium", 600: "Semi-Bold", 700: "Bold" })[w] ?? String(w);

const typeScale = () =>
  ["| Element | Size | Weight | Line height |", "|---|---|---|---|",
   ...["h1", "h2", "h3", "body", "caption"].map((k) => {
     const t = tokens.text[k];
     return `| ${k.toUpperCase()} | ${t.fontSize} | ${weightName(t.fontWeight)} (${t.fontWeight}) | ${t.lineHeight} |`;
   })].join("\n");

const typeSpecimen = (attrs) => {
  const family = attrs.match(/family=["']([^"']+)["']/)?.[1];
  const stack = tokens.font.family.primary.join(", ");
  return family
    ? `_Specimen: **${family}** (fallback face)._`
    : `**Font stack:** \`${stack}\``;
};

const assetGrid = (attrs) => {
  const kind = attrs.match(/kind=["']([^"']+)["']/)?.[1];
  if (kind === "logos") {
    return assets.logos.map((b) => {
      const rows = b.variants.map((v) => {
        const links = Object.entries(v.files).map(([f, file]) => `[${f.toUpperCase()}](${file.url}) (${kb(file.bytes)})`).join(" · ");
        return `| ${label(v.variant)} | ${v.description} | ${links} |`;
      });
      return `### ${b.name}\n\n| Variant | Use | Files |\n|---|---|---|\n${rows.join("\n")}`;
    }).join("\n\n");
  }
  if (kind === "favicons") {
    return assets.favicons.map((i) =>
      `- **${label(i.slug)}** — ${Object.entries(i.files).map(([f, file]) => `[${f.toUpperCase()}](${file.url})`).join(" · ")}`).join("\n");
  }
  if (kind === "illustrations") {
    return assets.illustrations.map((s) =>
      `### ${s.name}\n\n${s.files.map((f) => `- **${label(f.colourway)}** — [GIF](${f.url}) (${kb(f.bytes)})`).join("\n")}`).join("\n\n");
  }
  if (kind === "imagery" || kind === "accreditations") {
    return assets[kind].map((g) =>
      `### ${g.heading}\n\n${g.items.map((i) => `- **${i.name}**${i.note ? ` — ${i.note}` : ""} — \`${i.file}\` — [download](${i.url}) (${kb(i.bytes)})`).join("\n")}`).join("\n\n");
  }
  return "";
};

const siteCards = () =>
  config.divisions.filter((d) => d.url).map((d) => `- **[${d.name}](${d.url})** — ${d.description}`).join("\n");

const RENDERERS = {
  ColourTable: colourTable,
  TypeScale: typeScale,
  TypeSpecimen: typeSpecimen,
  AssetGrid: assetGrid,
  SiteCards: siteCards,
  DownloadButton: (attrs) => {
    const href = attrs.match(/href=["']([^"']+)["']/)?.[1] ?? "";
    const text = attrs.match(/label=["']([^"']+)["']/)?.[1] ?? "Download";
    return `[${text}](${href})`;
  },
};

/* ---------- per page ---------- */

/**
 * The route Starlight will serve a file at, which is not the same as the file's path:
 * a trailing /index is dropped, so templates/index.md is served at /templates/.
 *
 * The footer's "Download this page as Markdown" link is built from that route, so the raw
 * file has to be named for the route too — /raw/templates.md, not /raw/templates/index.md.
 * Naming it after the file gave every section index page a 404 on that link.
 *
 * The site root is the one page that keeps the name: it has no directory to be named after.
 */
const routeSlug = (relPath) =>
  relPath.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "") || "index";

const convert = (raw, slug) => {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const front = fm?.[1] ?? "";
  const title = front.match(/^title:\s*(.+)$/m)?.[1].replace(/^["']|["']$/g, "") ?? path.basename(slug);
  const description = front.match(/^description:\s*(.+)$/m)?.[1].replace(/^["']|["']$/g, "") ?? "";

  let body = fm ? raw.slice(fm[0].length) : raw;
  body = body.replace(/^import .+ from ".+";$/gm, "");

  // Self-closing component tags, e.g. <ColourTable set="core" />
  body = body.replace(/<([A-Z][\w]*)([^>]*?)\/>/g, (match, name, attrs) =>
    RENDERERS[name] ? `\n${RENDERERS[name](attrs)}\n` : "");
  // Any component tags left over (paired) — drop the tags, keep inner text.
  body = body.replace(/<\/?[A-Z][\w]*[^>]*>/g, "");

  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const url = slug === "index" ? `${config.site}/` : `${config.site}/${slug}/`;

  return `# ${title}\n\n${description ? `> ${description}\n\n` : ""}` +
    `_From the ${config.name} brand hub — ${url}_\n\n---\n\n${body}\n`;
};

/* ---------- walk ---------- */

fs.rmSync(OUT, { recursive: true, force: true });
let count = 0;

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (!/\.mdx?$/.test(e.name)) continue;

    const rel = path.relative(DOCS, full);
    const slug = routeSlug(rel);
    const raw = fs.readFileSync(full, "utf8");
    const out = path.join(OUT, `${slug}.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, convert(raw, slug));
    count++;
  }
};
walk(DOCS);

console.log(`raw markdown written — ${count} pages → public/raw/`);
