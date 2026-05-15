// @ts-nocheck - this file is serialised via toString() and injected into
// the browser by Playwright's addInitScript. It references DOM globals
// (navigator, NavigatorUAData) that the package's Node-only tsconfig
// deliberately doesn't load.

/**
 * Overrides `navigator.userAgentData` (Client Hints API) so the page
 * sees the same brand identity as the configured user-agent string.
 *
 * Playwright's `userAgent` context option only spoofs the UA string and
 * the HTTP header — it does not touch `userAgentData`. Sites that read
 * `navigator.userAgentData.brands` (rather than parsing the UA string)
 * will otherwise see the underlying Chromium engine, even when we've
 * told the page it's Chrome.
 *
 * @param userAgent - The full User-Agent string. The Chrome major
 *   version is parsed out and used to populate the brand entries.
 */
export function spoofUserAgentData(opts: { userAgent: string }): void {
  const ua = opts.userAgent;
  const versionMatch = ua.match(/Chrome\/(\d+)/);
  const major = versionMatch ? versionMatch[1] : "131";
  const platform = ua.includes("Macintosh")
    ? "macOS"
    : ua.includes("Windows")
      ? "Windows"
      : "Linux";
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    get: () => ({
      brands: [
        { brand: "Google Chrome", version: major },
        { brand: "Chromium", version: major },
        { brand: "Not.A/Brand", version: "99" },
      ],
      mobile: false,
      platform,
    }),
  });
}
