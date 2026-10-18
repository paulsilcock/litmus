import { describe, expect, it } from "vite-plus/test";

import { assertPublishableVersion, distTags } from "./dist-tags.ts";

describe("distTags", () => {
  it("a release candidate before any stable release is tagged rc and latest", () => {
    expect(distTags("0.1.0-rc.2", { stableReleaseExists: false })).toEqual([
      "latest",
      "rc",
    ]);
  });

  it("a stable release is tagged latest", () => {
    expect(distTags("0.1.0", { stableReleaseExists: false })).toEqual([
      "latest",
    ]);
    expect(distTags("0.2.0", { stableReleaseExists: true })).toEqual([
      "latest",
    ]);
  });

  it("a release candidate after a stable release is tagged rc only, so latest stays stable", () => {
    expect(distTags("0.2.0-rc.0", { stableReleaseExists: true })).toEqual([
      "rc",
    ]);
  });
});

describe("assertPublishableVersion", () => {
  it.each(["v0.1.0", "0.1", "01.0.0", "0.1.0-", "0.1.0+build"])(
    "rejects %s, which is not a semantic version",
    (version) => {
      expect(() => assertPublishableVersion(version)).toThrow(
        /not a valid version/,
      );
    },
  );

  it("rejects a pre-release label that npm would read as a version number", () => {
    expect(() => assertPublishableVersion("0.1.0-1")).toThrow(
      /must start with a name/,
    );
  });
});
