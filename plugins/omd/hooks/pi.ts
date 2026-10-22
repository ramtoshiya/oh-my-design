import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const bridge = fileURLToPath(new URL("./bridge.cjs", import.meta.url));

function run(event: string, payload: Record<string, unknown>, cwd: string, signal?: AbortSignal) {
  return new Promise<string | undefined>((resolve) => {
    const child = execFile("node", [bridge, event], {
      cwd, signal, timeout: 900, maxBuffer: 256 * 1024, encoding: "utf8",
      killSignal: "SIGKILL",
    }, (error, stdout) => {
      if (error || !stdout.trim()) return resolve(undefined);
      try {
        const context = JSON.parse(stdout).hookSpecificOutput?.additionalContext;
        resolve(typeof context === "string" && context.trim() ? context : undefined);
      } catch { resolve(undefined); }
    });
    child.stdin?.on("error", () => {
      child.kill("SIGKILL");
      resolve(undefined);
    });
    child.stdin?.end(JSON.stringify({ ...payload, cwd, host: "pi" }));
  });
}

export default function hooks(pi: ExtensionAPI) {
  // Lifecycle state belongs to the active Pi session, not a pending tool call.
  let sessionStart = true;
  pi.on("session_start", () => { sessionStart = true; });
  pi.on("session_switch", () => { sessionStart = true; });
  pi.on("before_agent_start", async (event, ctx) => {
    const context = await run("TurnStart", {
      prompt: event.messageType === "user" ? event.prompt : "", session_start: sessionStart,
    }, ctx.cwd, ctx.signal);
    sessionStart = false;
    if (context) return { message: {
      customType: "omd-context", content: context, display: true,
    } };
  });
  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !["write", "edit"].includes(event.toolName)) return;
    const context = await run("PostToolUse", {
      tool_name: event.toolName, tool_input: event.input,
    }, ctx.cwd, ctx.signal);
    if (!context) return;
    return {
      content: [...event.content, { type: "text" as const, text: context }],
      details: event.details,
      structuredContent: event.structuredContent,
    };
  });
  pi.on("agent_end", async (_event, ctx) => {
    await run("Stop", {}, ctx.cwd, ctx.signal);
  });
}
