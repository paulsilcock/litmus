/**
 * Builds and publishes every public package at one version.
 *
 *   node scripts/release.ts v0.1.0-rc.0 [--dry-run]
 *
 * The version comes only from the tag; package.json files in the repo stay
 * at 0.0.0. The script sets the version, builds, packs each package with
 * Bun (which replaces `catalog:` and `workspace:` with real versions) and
 * publishes the tarballs with npm. It restores every package.json when it
 * finishes, so a local run leaves the working tree as it was.
 *
 * The GitHub release workflow runs it with trusted publishing. For a first
 * publish from your machine, run `npm login` first.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { releasePlan } from "./release-version.ts";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tag = args.find((arg) => !arg.startsWith("--"));
if (tag === undefined) {
  console.error("Usage: node scripts/release.ts <tag> [--dry-run]");
  process.exit(1);
}

const plan = releasePlan(tag);
const packages = publicPackages();
console.log(
  `Releasing ${plan.version} (npm dist-tag "${plan.distTag}") for ${packages.map((p) => p.name).join(", ")}${dryRun ? " [dry run]" : ""}`,
);

for (const pkg of packages) {
  if (isPublished(pkg.name, plan.version)) {
    throw new Error(`${pkg.name}@${plan.version} is already on npm.`);
  }
}

const originals = new Map(
  packages.map((pkg) => [pkg.manifestPath, readFileSync(pkg.manifestPath)]),
);
try {
  for (const pkg of packages) {
    setVersion(pkg.manifestPath, plan.version);
  }
  run("vp", ["run", "-r", "build"], root);

  const outDir = mkdtempSync(join(tmpdir(), "litmus-release-"));
  for (const pkg of packages) {
    run("vp", ["pm", "pack", "--", "--destination", outDir], pkg.dir);
  }

  // Dependencies first, so a consumer never sees a package whose
  // @litmus dependency is missing at the same version.
  const order = ["@litmus/core", ...packages.map((p) => p.name)];
  const tarballs = readdirSync(outDir);
  for (const name of new Set(order)) {
    const file = `${name.replace("@", "").replace("/", "-")}-${plan.version}.tgz`;
    if (!tarballs.includes(file)) {
      throw new Error(`Expected tarball ${file} in ${outDir}.`);
    }
    run(
      "npm",
      [
        "publish",
        join(outDir, file),
        "--access",
        "public",
        "--tag",
        plan.distTag,
        ...(dryRun ? ["--dry-run"] : []),
      ],
      root,
    );
  }
} finally {
  for (const [path, contents] of originals) {
    writeFileSync(path, contents);
  }
}

function publicPackages() {
  const dir = join(root, "packages");
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const name = entry.name;
    const manifestPath = join(dir, name, "package.json");
    const manifest: PackageJson = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    );
    if (manifest.private === true) return [];
    return [{ name: manifest.name, dir: join(dir, name), manifestPath }];
  });
}

// Bun resolves `workspace:` from the lockfile, which still holds 0.0.0, so
// the internal references are pinned here before packing.
function setVersion(manifestPath: string, version: string) {
  const manifest: Record<string, unknown> = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  );
  manifest["version"] = version;
  for (const field of ["dependencies", "peerDependencies"]) {
    const deps = manifest[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        Reflect.set(deps, name, version);
      }
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isPublished(name: string, version: string): boolean {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() !== "";
  } catch (error) {
    // A package that has never been published returns E404.
    if (String(error).includes("E404")) return false;
    throw error;
  }
}

function run(command: string, commandArgs: string[], cwd: string) {
  console.log(`$ ${command} ${commandArgs.join(" ")}`);
  execFileSync(command, commandArgs, { cwd, stdio: "inherit" });
}
