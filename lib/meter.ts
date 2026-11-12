// Token counter for every model call, so the red-team eval can report what it cost.
type Usage = { calls: number; input: number; output: number };
const g = globalThis as unknown as { __usage?: Usage };
export const usage: Usage = (g.__usage ??= { calls: 0, input: 0, output: 0 });
export const meter = (u?: { input_tokens?: number; output_tokens?: number }) => { usage.calls++; usage.input += u?.input_tokens ?? 0; usage.output += u?.output_tokens ?? 0; };
