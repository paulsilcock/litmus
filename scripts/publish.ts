/**
 * Publishes every public package at the version in package.json.
 *
 *   node scripts/publish.ts 0.1.0-rc.1 [--dry-run]
 *
 * Run it after `vp run -r build`. The publish workflow runs it with npm
 * trusted publishing; for a first publish from your machine, run
 * `npm login` first. pnpm replaces `workspace:` and `catalog:` references
 * with real versions, and skips private packages.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { distTag } from "./dist-tag.ts";

const version = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (version === undefined || version.startsWith("--")) {
  throw new Error("Usage: node scripts/publish.ts <version> [--dry-run]");
}

const root = join(import.meta.dirname, "..");
const manifest: { version: string } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
);
if (manifest.version !== version) {
  throw new Error(
    `Version "${version}" does not match package.json version "${manifest.version}".`,
  );
}

const tag = distTag(version);
console.log(
  `Publishing ${version} with npm dist-tag "${tag}"${dryRun ? " (dry run)" : ""}`,
);
// Not `vp run`: tasks run in a clean environment, which would drop the
// ACTIONS_ID_TOKEN_REQUEST_* variables that trusted publishing needs.
execFileSync(
  "vp",
  [
    "pm",
    "publish",
    "-r",
    "--access",
    "public",
    "--no-git-checks",
    "--tag",
    tag,
    ...(dryRun ? ["--dry-run"] : []),
  ],
  { cwd: root, stdio: "inherit" },
);
