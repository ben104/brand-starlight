# brand-starlight

A generic [Astro Starlight](https://starlight.astro.build/) engine for brand hubs. It
contains **no brand values** — no colours, no copy, no logos. Content, design tokens and
configuration are synced in from a brand repository at build time.

That separation is the point: one engine serves every brand, and an improvement here
reaches all of them without a fork.

## Running it

```bash
npm install
BRAND_REPO=../inspectas-brand npm run dev
```

`BRAND_REPO` defaults to `../inspectas-brand`. The brand repo must have been built first —
the engine needs its `dist/tokens.css`, and will tell you so if it's missing:

```bash
cd ../inspectas-brand && npm install && npm run build
```

## Commands

```bash
npm run sync    # copy a brand's content, assets, tokens and config into the engine
npm run raw     # generate the per-page Markdown downloads into public/raw/
npm run build   # sync → raw → astro build
npm run dev     # sync, then a dev server
```

`raw` must run **before** `astro build` — Astro copies `public/` into `dist/` as part of the
build, so anything generated afterwards never reaches the published site. `npm run build`
already orders it correctly.

## What the engine expects from a brand repo

| Path | Purpose |
|---|---|
| `brand.config.json` | Site title, logo, font, sections, divisions |
| `<section.dir>/` | Markdown and MDX pages, one folder per configured section |
| `03-assets/files/` | Binary assets — served at `/assets/…` |
| `03-assets/assets.json` | Generated asset manifest, read by `<AssetGrid />` |
| `dist/tokens.json` | Resolved design tokens, read by `<ColourTable />` and `<TypeSpecimen />` |
| `dist/tokens.css` | CSS custom properties — the entire visual theme |

## Components

Brand content uses these as bare tags. **No import statement is needed** — `sync-brand.mjs`
detects which components a page uses and injects the imports on the way in. Content is
edited by non-technical people through GitHub's web editor, and an import line at the top of
every page is one more thing for them to break.

| Component | What it renders |
|---|---|
| `<ColourTable set="core\|divisions" />` | Swatches from tokens, with computed WCAG contrast |
| `<TypeSpecimen family="…" />` | A live specimen at the brand's own type scale |
| `<TypeScale />` | The type scale as a table |
| `<AssetGrid kind="logos\|favicons\|illustrations\|imagery\|accreditations" />` | Asset catalogue from the manifest |
| `<DownloadButton href label bytes external />` | A download link with a human-readable size |
| `<SiteCards />` | The division websites from `brand.config.json` |

To add a component, create it in `src/components/` and add its name to `COMPONENTS` in
`scripts/sync-brand.mjs`.

## Theming

`src/styles/custom.css` maps the brand's tokens onto Starlight's own theme variables. It
contains no colour values of its own — every rule reads a `--color-*` or `--brand-*` custom
property that the brand's token package defines.

Division theming comes free: the token package emits `[data-division="…"]` scopes, so any
element inside one picks up that division's palette through `--brand-primary`.

## Adding a brand

1. Point `BRAND_REPO` at it.
2. Make sure it has a `brand.config.json` and has been built.

There is no step three. If the engine needs changing to accommodate a brand, something
brand-specific has leaked into it.
