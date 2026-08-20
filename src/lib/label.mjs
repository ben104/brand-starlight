/**
 * Renders a slug as human-readable text.
 *
 * Slugs stay lowercase wherever they are identifiers — token names, CSS custom properties,
 * asset filenames — so they must not be title-cased naively for display: that turns "cdm"
 * into "Cdm" and "fss" into "Fss". The brand owns the exceptions, in brand.config.json,
 * because another brand will have different acronyms.
 */
import brand from "../brand/brand.config.json" with { type: "json" };

const overrides = brand.labels ?? {};

export const label = (slug) =>
  overrides[slug] ??
  String(slug).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default label;
