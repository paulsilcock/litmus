export interface ReleasePlan {
  version: string;
  /** The npm dist-tag the version is published under. */
  distTag: string;
  prerelease: boolean;
}

// `v` + MAJOR.MINOR.PATCH, optionally `-` + dot-separated pre-release
// identifiers. Build metadata (`+...`) is not accepted: npm ignores it.
const RELEASE_TAG =
  /^v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?)$/;

/**
 * Derives what to publish from a release tag such as `v0.1.0` or
 * `v0.1.0-rc.0`. A pre-release is published under its first label
 * (`rc`, `beta`, ...) so that `npm install` without a tag never picks it.
 */
export function releasePlan(tag: string): ReleasePlan {
  const match = RELEASE_TAG.exec(tag);
  const version = match?.groups?.["version"];
  if (version === undefined) {
    throw new Error(
      `"${tag}" is not a valid release tag. Use v + a semantic version, e.g. v0.1.0 or v0.1.0-rc.0.`,
    );
  }

  const pre = match?.groups?.["pre"];
  if (pre === undefined) {
    return { version, distTag: "latest", prerelease: false };
  }

  const label = pre.split(".")[0] ?? "";
  if (!/^[A-Za-z]/.test(label)) {
    throw new Error(
      `The pre-release label in "${tag}" must start with a name, e.g. v0.1.0-rc.0.`,
    );
  }
  return { version, distTag: label, prerelease: true };
}
