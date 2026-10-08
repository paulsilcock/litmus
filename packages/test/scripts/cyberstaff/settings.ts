// Settings come from the repo's .env, unless already set in the shell.
process.loadEnvFile(new URL("../../../../.env", import.meta.url));

/**
 * Whether to run the Cyberstaff evals, which place real, paid calls: only
 * when asked, and never in CI (which sets `CI`).
 */
export const evalsEnabled =
  process.env["CYBERSTAFF_EVALS"] === "1" && process.env["CI"] === undefined;

export function setting(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the repo's .env first.`);
  return value;
}
