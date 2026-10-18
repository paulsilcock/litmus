// MAJOR.MINOR.PATCH, optionally `-` + dot-separated pre-release
// identifiers. Build metadata (`+...`) is not accepted: npm ignores it.
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * The npm dist-tag to publish `version` under: `latest` for a release, or
 * the first pre-release label (`rc`, `beta`, ...) so that `npm install`
 * without a tag never picks a pre-release.
 */
export function distTag(version: string): string {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new Error(
      `"${version}" is not a valid version. Use a semantic version, e.g. 0.1.0 or 0.1.0-rc.0.`,
    );
  }

  const pre = match.groups?.["pre"];
  if (pre === undefined) return "latest";

  const label = pre.split(".")[0] ?? "";
  if (!/^[A-Za-z]/.test(label)) {
    throw new Error(
      `The pre-release label in "${version}" must start with a name, e.g. 0.1.0-rc.0.`,
    );
  }
  return label;
}
