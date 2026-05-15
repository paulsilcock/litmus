// @ts-nocheck - this file runs inside the browser via Playwright's
// `addInitScript`. It references DOM globals (navigator) that aren't loaded
// in the package's Node-only tsconfig. Adding the DOM lib here would pollute
// the project's type space, so we opt out of type-checking instead.

/**
 * Overrides `navigator.userAgent` (legacy string) and `navigator.userAgentData`
 * (modern Sec-CH-UA equivalent) so the page sees a consistent Chrome
 * identity, not Chromium/HeadlessChrome. Some sites condition widget
 * embedding on these and silently skip for non-Chrome browsers.
 *
 * @param userAgent - The full User-Agent string. The function parses out the
 *   major Chrome version to populate the userAgentData brand list.
 */
export function spoofUserAgentData(opts: { userAgent: string }): void {
  const ua = opts.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    get: () => ua,
    configurable: true,
  });

  const versionMatch = ua.match(/Chrome\/(\d+)/);
  const major = versionMatch ? versionMatch[1] : "131";
  const fakeUAData = {
    brands: [
      { brand: "Google Chrome", version: major },
      { brand: "Chromium", version: major },
      { brand: "Not.A/Brand", version: "99" },
    ],
    mobile: false,
    platform: ua.includes("Macintosh")
      ? "macOS"
      : ua.includes("Windows")
        ? "Windows"
        : "Linux",
    getHighEntropyValues(hints) {
      const high = {
        architecture: "arm",
        bitness: "64",
        model: "",
        platformVersion: "15.0.0",
        uaFullVersion: `${major}.0.0.0`,
        fullVersionList: [
          { brand: "Google Chrome", version: `${major}.0.0.0` },
          { brand: "Chromium", version: `${major}.0.0.0` },
          { brand: "Not.A/Brand", version: "99.0.0.0" },
        ],
        wow64: false,
      };
      const result = {
        brands: fakeUAData.brands,
        mobile: false,
        platform: fakeUAData.platform,
      };
      for (const h of hints) {
        if (h in high) result[h] = high[h];
      }
      return Promise.resolve(result);
    },
    toJSON() {
      return {
        brands: this.brands,
        mobile: this.mobile,
        platform: this.platform,
      };
    },
  };
  Object.defineProperty(navigator, "userAgentData", {
    get: () => fakeUAData,
    configurable: true,
  });
}
