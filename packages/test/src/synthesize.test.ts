import { existsSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockLanguageModelV3 } from "ai/test";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import { synthesize } from "#litmus-test/synthesize.ts";

const mockUsage = {
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
};

describe("synthesize", () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "synth-"));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    const testPath = expect.getState().testPath;
    if (testPath) {
      rmSync(testPath.replace(/\.test\.[jt]sx?$/, ".scenarios.json"), {
        force: true,
      });
    }
  });

  it("fans out seeds into more of the same shape", async () => {
    const schema = z.object({ message: z.string() });
    const seeds = [
      { message: "I want a refund" },
      { message: "My order never arrived" },
      { message: "I was charged twice" },
    ];
    const variants = 5;

    const generated = Array.from({ length: variants }, (_, i) => ({
      message: `synthesised ${i + 1}`,
    }));

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          { type: "text", text: JSON.stringify({ scenarios: generated }) },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const scenarios = await synthesize({
      model,
      schema,
      seeds,
      variants,
      prompt: (s, v) => `produce ${v} from ${s.length}`,
      mode: "regenerate",
    });

    expect(scenarios).toHaveLength(seeds.length + variants);
    for (const scenario of scenarios) {
      expect(() => schema.parse(scenario)).not.toThrow();
    }
  });

  it("the caller's prompt drives what the model is asked", async () => {
    let captured = "";
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        captured = JSON.stringify(prompt);
        return {
          ...mockUsage,
          content: [{ type: "text", text: JSON.stringify({ scenarios: [] }) }],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    await synthesize({
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "first" }, { message: "second" }],
      variants: 7,
      prompt: (seeds, variants) =>
        `make ${variants} variants from ${seeds.length} seeds`,
      mode: "regenerate",
    });

    expect(captured).toContain("make 7 variants from 2 seeds");
  });

  it("running with a missing cache fails with a regenerate instruction", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("model should not be called");
      },
    });

    const cachePath = join(cacheDir, "missing.scenarios.json");

    await expect(
      synthesize({
        model,
        schema: z.object({ message: z.string() }),
        seeds: [{ message: "seed" }],
        variants: 3,
        prompt: (s, v) => `${v} from ${s.length}`,
        cache: cachePath,
      }),
    ).rejects.toThrow(/LITMUS_SYNTH_MODE=regenerate/);
  });

  it("regeneration can be enabled without code changes via an env var", async () => {
    vi.stubEnv("LITMUS_SYNTH_MODE", "regenerate");

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          {
            type: "text",
            text: JSON.stringify({ scenarios: [{ message: "fresh" }] }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const result = await synthesize({
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "seed" }],
      variants: 1,
      prompt: () => "p",
      cache: join(cacheDir, "missing.scenarios.json"),
    });

    expect(result).toEqual([{ message: "seed" }, { message: "fresh" }]);
  });

  it("a cache produced from different inputs is rejected", async () => {
    const cachePath = join(cacheDir, "x.scenarios.json");

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          {
            type: "text",
            text: JSON.stringify({ scenarios: [{ message: "x" }] }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const base = {
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "seed" }],
      variants: 1,
      cache: cachePath,
    };

    await synthesize({
      ...base,
      prompt: () => "first prompt",
      mode: "regenerate",
    });

    await expect(
      synthesize({ ...base, prompt: () => "different prompt" }),
    ).rejects.toThrow(/LITMUS_SYNTH_MODE=regenerate/);
  });

  it("scenarios cached during a test run live next to the test file by default", async () => {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error("test path unavailable");
    const expected = testPath.replace(/\.test\.[jt]sx?$/, ".scenarios.json");

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          {
            type: "text",
            text: JSON.stringify({ scenarios: [{ message: "auto" }] }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    await synthesize({
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "seed" }],
      variants: 1,
      prompt: () => "p",
      mode: "regenerate",
    });

    expect(existsSync(expected)).toBe(true);
  });

  it("scenarios with different names live in distinct cache files", async () => {
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error("test path unavailable");
    const stem = testPath.replace(/\.test\.[jt]sx?$/, "");
    const firstPath = `${stem}.first.scenarios.json`;
    const secondPath = `${stem}.second.scenarios.json`;

    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        ...mockUsage,
        content: [
          {
            type: "text",
            text: JSON.stringify({ scenarios: [{ message: "x" }] }),
          },
        ],
        finishReason: { unified: "stop", raw: undefined },
      }),
    });

    const base = {
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "seed" }],
      variants: 1,
      prompt: () => "p",
      mode: "regenerate" as const,
    };

    try {
      await synthesize({ ...base, name: "first" });
      await synthesize({ ...base, name: "second" });

      expect(existsSync(firstPath)).toBe(true);
      expect(existsSync(secondPath)).toBe(true);
    } finally {
      rmSync(firstPath, { force: true });
      rmSync(secondPath, { force: true });
    }
  });

  it("a repeat run with the same inputs avoids calling the model", async () => {
    let calls = 0;
    const generated = Array.from({ length: 3 }, (_, i) => ({
      message: `synthesised ${i + 1}`,
    }));
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls++;
        return {
          ...mockUsage,
          content: [
            { type: "text", text: JSON.stringify({ scenarios: generated }) },
          ],
          finishReason: { unified: "stop", raw: undefined },
        };
      },
    });

    const opts = {
      model,
      schema: z.object({ message: z.string() }),
      seeds: [{ message: "seed" }],
      variants: 3,
      prompt: (s: { message: string }[], v: number) =>
        `produce ${v} from ${s.length}`,
      cache: join(cacheDir, "x.scenarios.json"),
    };

    const first = await synthesize({ ...opts, mode: "regenerate" });
    const second = await synthesize(opts);

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });
});
