import type { Turn } from "#litmus-test/conversation.ts";

/** Prints a call's turns as they happen. Pass as a simulator's `watch`. */
export function printTurn(turn: Turn): void {
  const who = turn.speaker === "simulatedUser" ? "Customer" : "Receptionist";
  console.log(`${who}: ${turn.content}`);
}
