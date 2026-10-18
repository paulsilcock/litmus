import { describe, expect, it } from "vite-plus/test";

import { distTag } from "./dist-tag.ts";

describe("distTag", () => {
  it("a release is published as latest", () => {
    expect(distTag("0.1.0")).toBe("latest");
  });

  it("a pre-release is published under its label, so it is never installed by default", () => {
    expect(distTag("0.1.0-rc.2")).toBe("rc");
  });

  it.each(["v0.1.0", "0.1", "01.0.0", "0.1.0-", "0.1.0+build"])(
    "rejects %s, which is not a semantic version",
    (version) => {
      expect(() => distTag(version)).toThrow(/not a valid version/);
    },
  );

  it("rejects a pre-release label that npm would read as a version number", () => {
    expect(() => distTag("0.1.0-1")).toThrow(/must start with a name/);
  });
});
