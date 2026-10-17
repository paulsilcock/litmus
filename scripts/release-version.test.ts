import { describe, expect, it } from "vite-plus/test";

import { releasePlan } from "./release-version.ts";

describe("releasePlan", () => {
  it("a release tag publishes its version as latest", () => {
    expect(releasePlan("v0.1.0")).toEqual({
      version: "0.1.0",
      distTag: "latest",
      prerelease: false,
    });
  });

  it("a pre-release tag publishes under its pre-release label", () => {
    expect(releasePlan("v0.1.0-rc.2")).toEqual({
      version: "0.1.0-rc.2",
      distTag: "rc",
      prerelease: true,
    });
  });

  it.each(["0.1.0", "v0.1", "v01.0.0", "v0.1.0-", "v0.1.0+build", "vX"])(
    "rejects %s, which is not v followed by a semantic version",
    (tag) => {
      expect(() => releasePlan(tag)).toThrow(/not a valid release tag/);
    },
  );

  it("rejects a pre-release label that would be read as a version number", () => {
    expect(() => releasePlan("v0.1.0-1")).toThrow(/must start with a name/);
  });
});
