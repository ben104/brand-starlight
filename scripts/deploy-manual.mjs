#!/usr/bin/env node
/**
 * Manual deploy to Hostinger, for when CI isn't wired up yet.
 *
 * Exists because hand-uploading files has one specific trap: dist/.htaccess contains the
 * literal placeholder __ORIGIN_SECRET__ after every build. Uploading it unsubstituted locks
 * the origin to a string published in the repo, and every request — including Cloudflare's
 * — gets a 403. That has happened once. This script makes it impossible.
 *
 * Credentials come from a Hostinger upload URL, which expires after ~6 hours:
 *   TUS_URL=... TUS_AUTH=... TUS_REST=... ORIGIN_SECRET=... node scripts/deploy-manual.mjs
 *
 * By default it uploads everything except assets/ and downloads/ — those are ~176 MB and
 * rarely change. Pass --all to include them.
 */
import fs from "node:fs";
import path from "node:path";

const ENGINE = path.join(import.meta.dirname, "..");
const DIST = path.join(ENGINE, "dist");

const { TUS_URL, TUS_AUTH, TUS_REST, ORIGIN_SECRET } = process.env;
const includeAll = process.argv.includes("--all");

const die = (m) => { console.error(`\ndeploy: ${m}\n`); process.exit(1); };

for (const [k, v] of Object.entries({ TUS_URL, TUS_AUTH, TUS_REST, ORIGIN_SECRET })) {
  if (!v) die(`${k} is not set.`);
}
if (!fs.existsSync(DIST)) die("no dist/ — run `npm run build` first.");

/* ---------- 1. the guard ---------- */
const htaccess = path.join(DIST, ".htaccess");
if (!fs.existsSync(htaccess)) die("dist/.htaccess is missing — the brand's deploy/.htaccess did not reach the build.");

let conf = fs.readFileSync(htaccess, "utf8");
if (conf.includes("__ORIGIN_SECRET__")) {
  fs.writeFileSync(htaccess, conf.replaceAll("__ORIGIN_SECRET__", ORIGIN_SECRET));
  console.log("injected the origin secret into dist/.htaccess");
} else if (!conf.includes(ORIGIN_SECRET)) {
  die("dist/.htaccess has neither the placeholder nor the current secret. Refusing to deploy — this would lock the origin to an unknown value.");
} else {
  console.log("dist/.htaccess already carries the current secret");
}

/* ---------- 2. collect files ---------- */
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(DIST, full);
    if (!includeAll && (rel.startsWith("assets/") || rel.startsWith("downloads/"))) continue;
    e.isDirectory() ? walk(full) : files.push(rel);
  }
};
walk(DIST);

const bytes = files.reduce((n, f) => n + fs.statSync(path.join(DIST, f)).size, 0);
console.log(`uploading ${files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB)${includeAll ? "" : " — excluding assets/ and downloads/"}`);

/* ---------- 3. upload ---------- */
const headers = {
  "X-Auth": TUS_AUTH,
  "X-Auth-Rest": TUS_REST,
  "Tus-Resumable": "1.0.0",
};

let done = 0;
const failed = [];
for (const rel of files) {
  const body = fs.readFileSync(path.join(DIST, rel));
  const target = `${TUS_URL}/${rel.split(path.sep).join("/")}?override=true`;
  try {
    const create = await fetch(target, {
      method: "POST",
      headers: { ...headers, "Upload-Length": String(body.byteLength), "Upload-Offset": "0" },
    });
    if (!create.ok) throw new Error(`create ${create.status}`);

    const send = await fetch(target, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/offset+octet-stream", "Upload-Offset": "0" },
      body,
    });
    if (!send.ok) throw new Error(`patch ${send.status}`);
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${files.length}`);
  } catch (error) {
    failed.push(`${rel}: ${error.message}`);
  }
}

console.log(`\nuploaded ${done}/${files.length}`);
if (failed.length) {
  console.error(`${failed.length} failed:`);
  for (const f of failed) console.error(`  ${f}`);
  process.exit(1);
}

/* ---------- 4. prove the origin lock still works ---------- */
// Read from the synced brand config rather than hardcoded — the engine must not carry
// brand values, or it stops being reusable.
const brandConfig = JSON.parse(fs.readFileSync(path.join(ENGINE, "src", "brand", "brand.config.json"), "utf8"));
const host = new URL(brandConfig.site).host;
const check = async (label, secret, expected) => {
  const res = await fetch(`https://${host}/`, {
    headers: secret === null ? {} : { "X-Origin-Secret": secret },
    redirect: "manual",
  });
  const ok = res.status === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: ${res.status} (expected ${expected})`);
  return ok;
};

console.log("\nverifying:");
// Through Cloudflare, so the only case testable without --resolve is the Access redirect.
const results = [await check("unauthenticated via Cloudflare", null, 302)];
if (results.every(Boolean)) {
  console.log("\ndeployed. Check the origin lock directly with:");
  console.log(`  curl -sI --resolve ${host}:443:$(dig +short ${host}.cdn.hstgr.net | head -1) https://${host}/`);
} else {
  die("post-deploy verification failed.");
}
