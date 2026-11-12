// Agents that move money. Claude drives; PayPal's Agent Toolkit executes; a code gate checks
// every money call against the buyer's mandate or the dealer's rules before it reaches PayPal.
import Anthropic from "@anthropic-ai/sdk";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";

const client = new Anthropic();
const MODEL = process.env.REVERSO_MODEL ?? "claude-opus-5-5";

let kit: PayPalAgentToolkit | null = null;
export const toolkit = () => (kit ??= new PayPalAgentToolkit({
  clientId: process.env.PAYPAL_CLIENT_ID ?? "",
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
  configuration: {
    actions: { orders: { create: true, get: true, capture: true }, payments: { createRefund: true, getRefunds: true }, transactions: { list: true } },
    context: { sandbox: true },
  },
}));

/** Runs one Agent Toolkit tool from code (also used after the gate approves an agent's call). */
export async function paypalTool(name: string, args: unknown): Promise<any> {
  const res = await toolkit().handleToolCall({ id: `call_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  try { return JSON.parse(text); } catch { return text; }
}

export type AppTool = { name: string; description: string; input_schema: Record<string, unknown>; run: (input: any) => Promise<unknown> | unknown };
/** A gate returns null to let the PayPal call through, or the reason it is refused. After a success it may record the result. */
export type Gate = { check: (input: any) => string | null; after?: (input: any, result: any) => void };
export type Event = { at: number; from: "agent" | "dealer" | "paypal" | "gate"; text: string };

/** The agent loop: Claude picks tools until it answers in plain text, or the turn budget runs out. */
export async function runAgent(o: {
  system: string; task: string; tools: AppTool[]; paypal: Record<string, Gate>; emit: (e: Omit<Event, "at">) => void; maxTurns?: number;
}): Promise<string> {
  const pp = toolkit().getTools().filter((t) => t.function.name in o.paypal);
  const tools: Anthropic.Tool[] = [
    ...o.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
    ...pp.map((t) => ({ name: t.function.name, description: `PayPal Agent Toolkit. ${t.function.description ?? ""}`.slice(0, 1000), input_schema: t.function.parameters as Anthropic.Tool.InputSchema })),
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: o.task }];
  for (let turn = 0; turn < (o.maxTurns ?? 10); turn++) {
    const res = await client.messages.create({ model: MODEL, max_tokens: 2000, system: o.system, tools, messages });
    messages.push({ role: "assistant", content: res.content });
    const said = res.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join(" ").trim();
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!calls.length) { if (said) o.emit({ from: "agent", text: said }); return said; }
    if (said) o.emit({ from: "agent", text: said });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const c of calls) {
      let out: unknown, isError = false;
      try {
        const app = o.tools.find((t) => t.name === c.name), gate = o.paypal[c.name];
        if (app) out = await app.run(c.input);
        else if (gate) {
          const refused = gate.check(c.input);
          if (refused) { isError = true; out = `Refused by Reverso's payment gate: ${refused}`; o.emit({ from: "gate", text: `Blocked ${c.name}: ${refused}` }); }
          else { out = await paypalTool(c.name, c.input); gate.after?.(c.input, out); }
        } else { isError = true; out = `Unknown tool ${c.name}`; }
      } catch (e) { isError = true; out = (e as Error).message; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: typeof out === "string" ? out : JSON.stringify(out), is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }
  return "I stopped after my turn budget.";
}
