/**
 * Publishes every public package at the version in package.json.
 *
 *   node scripts/publish.ts 0.1.0-rc.1 [--dry-run]
 *
 * Tags (see dist-tags.ts): a release is tagged `latest`; a release
 * candidate is tagged `rc`, and also `latest` while no stable release
 * exists on npm.
 *
 * Run it after `vp run -r build`. The publish workflow runs it with npm
 * trusted publishing; for a first publish from your machine, run
 * `npm login` first. pnpm replaces `workspace:` and `catalog:` references
 * with real versions, and skips private packages.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { distTags } from "./dist-tags.ts";

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

const packages = publicPackageNames();
const [publishTag, ...extraTags] = distTags(version, {
  stableReleaseExists: await stableReleaseExists(packages[0] ?? ""),
});
if (publishTag === undefined) throw new Error("No dist-tag to publish under.");
console.log(
  `Publishing ${version} with dist-tags ${[publishTag, ...extraTags].join(", ")}${dryRun ? " (dry run)" : ""}`,
);

// Not `vp run`: tasks run in a clean environment, which would drop the
// ACTIONS_ID_TOKEN_REQUEST_* variables that trusted publishing needs.
vp([
  "pm",
  "publish",
  "-r",
  "--access",
  "public",
  "--no-git-checks",
  "--tag",
  publishTag,
  ...(dryRun ? ["--dry-run"] : []),
]);

// A publish sets one tag, so further tags are added per package. With
// trusted publishing this needs "Allow npm dist-tag" on each package.
// `vp pm dist-tag` (and pnpm) run the npm bundled with Node, but npm needs
// 11.21.0 or later to change dist-tags with trusted publishing, so a pinned
// npm is run instead.
if (!dryRun) {
  for (const tag of extraTags) {
    for (const name of packages) {
      vp(["dlx", "npm@11.21.0", "dist-tag", "add", `${name}@${version}`, tag]);
    }
  }
}

function vp(args: string[]) {
  execFileSync("vp", args, { cwd: root, stdio: "inherit" });
}

function publicPackageNames(): string[] {
  const dir = join(root, "packages");
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const pkg: { name: string; private?: boolean } = JSON.parse(
      readFileSync(join(dir, entry.name, "package.json"), "utf8"),
    );
    return pkg.private === true ? [] : [pkg.name];
  });
}

// All packages are released together, so one package's versions answer for
// all of them.
async function stableReleaseExists(name: string): Promise<boolean> {
  const response = await fetch(
    `https://registry.npmjs.org/${name.replace("/", "%2f")}`,
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Could not read ${name} from npm: ${response.status}`);
  }
  const metadata: { versions?: Record<string, unknown> } =
    await response.json();
  return Object.keys(metadata.versions ?? {}).some((v) => !v.includes("-"));
}
