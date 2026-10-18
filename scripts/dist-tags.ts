// MAJOR.MINOR.PATCH, optionally `-` + dot-separated pre-release
// identifiers. Build metadata (`+...`) is not accepted: npm ignores it.
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * The npm dist-tags for `version`, the first being the one it is published
 * under:
 *
 * - a release is tagged `latest`;
 * - a pre-release is tagged with its label (`rc`), and also `latest` while
 *   no stable release exists, so `npm install` gets the newest version.
 */
export function distTags(
  version: string,
  { stableReleaseExists }: { stableReleaseExists: boolean },
): string[] {
  const label = preReleaseLabel(version);
  if (label === undefined) return ["latest"];
  return stableReleaseExists ? [label] : ["latest", label];
}

/** Throws unless `version` is a version npm can publish. */
export function assertPublishableVersion(version: string): void {
  preReleaseLabel(version);
}

function preReleaseLabel(version: string): string | undefined {
  const match = VERSION.exec(version);
  if (match === null) {
    throw new Error(
      `"${version}" is not a valid version. Use a semantic version, e.g. 0.1.0 or 0.1.0-rc.0.`,
    );
  }

  const pre = match.groups?.["pre"];
  if (pre === undefined) return undefined;

  const label = pre.split(".")[0] ?? "";
  if (!/^[A-Za-z]/.test(label)) {
    throw new Error(
      `The pre-release label in "${version}" must start with a name, e.g. 0.1.0-rc.0.`,
    );
  }
  return label;
}
