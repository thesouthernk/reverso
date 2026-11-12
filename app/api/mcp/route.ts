// MCP endpoint (Streamable HTTP, stateless): add it to Claude as a remote MCP server at /api/mcp.
import { handle } from "@/lib/mcp";

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 }); }
  const msgs = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(msgs.map((m) => handle(m, request)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? out : out[0]);
}
// No server-initiated stream: clients fall back to plain request/response.
export const GET = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
