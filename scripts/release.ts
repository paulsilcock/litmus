/**
 * Sets one version in every package.json and commits it as
 * "chore: release v<version>".
 *
 *   RELEASE_VERSION=0.1.0-rc.1 node scripts/release.ts
 *
 * Without RELEASE_VERSION, bumpp asks for the version. The Prepare release
 * workflow runs this and opens a PR; merging that PR publishes the packages
 * (see .github/workflows/publish.yml).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  type VersionBumpRelease,
  type VersionNumber,
  versionBump,
} from "bumpp";

import { distTag } from "./dist-tag.ts";

const root = join(import.meta.dirname, "..");
const files = [
  "package.json",
  ...readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/package.json`),
];

const input = process.env["RELEASE_VERSION"];
let release: VersionBumpRelease = "prompt";
if (input) {
  // Throws for anything that is not a version npm can publish.
  distTag(input);
  if (isVersionNumber(input)) release = input;
}

await versionBump({
  cwd: root,
  files,
  release,
  commit: "chore: release v%s",
  tag: false,
  push: false,
  printCommits: false,
  confirm: release === "prompt",
});

function isVersionNumber(value: string): value is VersionNumber {
  return /^\d/.test(value);
}
