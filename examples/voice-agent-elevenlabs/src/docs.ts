/**
 * Fetches the given ElevenLabs docs URLs and returns a single
 * concatenated text snapshot suitable for grounding an LLM judge.
 *
 * Each page is stripped of HTML markup, normalised, and truncated. The
 * grader only needs enough context to verify specific factual claims,
 * not a verbatim render of the docs.
 *
 * Failures are surfaced as exceptions — a stale eval grounded in
 * "(404)" content would be worse than one that fails fast.
 */

const PER_PAGE_BUDGET_CHARS = 4_000;

export async function fetchElevenLabsDocs(urls: string[]): Promise<string> {
  const sections = await Promise.all(
    urls.map(async (url) => {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
      });
      if (!res.ok) {
        throw new Error(
          `fetchElevenLabsDocs: ${url} returned HTTP ${res.status}`,
        );
      }
      const html = await res.text();
      const text = htmlToText(html).slice(0, PER_PAGE_BUDGET_CHARS);
      return `### ${url}\n\n${text}`;
    }),
  );
  return sections.join("\n\n---\n\n");
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
