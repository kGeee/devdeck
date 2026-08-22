import type { AgentProvider } from "../types";
import type { Adapter, Sink } from "./base";
import { createClaudeAdapter } from "./claude";
import { createCodexAdapter } from "./codex";
import { createGeminiAdapter } from "./gemini";

export function createAdapter(provider: AgentProvider, sink: Sink): Adapter {
  switch (provider) {
    case "claude":
      return createClaudeAdapter(sink);
    case "codex":
      return createCodexAdapter(sink);
    case "gemini":
      return createGeminiAdapter(sink);
  }
}

export type { Adapter, Sink } from "./base";
