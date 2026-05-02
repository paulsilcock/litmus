/** Label-formatting helpers for evaluation runs. */

/**
 * Default per-scenario label: prefers `scenario.name`, falls back to
 * `scenario.id`, then to the literal `"scenario"` for shapes that
 * carry neither.
 */
export function scenarioLabel(scenario: unknown): string {
  if (typeof scenario === "object" && scenario !== null) {
    if ("name" in scenario && typeof scenario.name === "string")
      return scenario.name;
    if ("id" in scenario && typeof scenario.id === "string") return scenario.id;
  }
  return "scenario";
}

/**
 * The label that appears in the vitest report for a single registered
 * evaluation. When `samples > 1`, we annotate the parent label with the
 * sample count and pass-rate so the configuration is visible alongside
 * the test name.
 */
export function evaluationLabel(
  parentLabel: string,
  samples: number,
  passRate: number,
): string {
  if (samples <= 1) return parentLabel;
  return `${parentLabel} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`;
}
