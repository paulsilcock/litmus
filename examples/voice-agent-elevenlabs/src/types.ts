// Re-export Litmus's Conversation/Turn for downstream files (the grader,
// DSL, bridge). Keeps imports in this example pinned to one shape.

export type { Conversation, Turn } from "@litmus/test";
