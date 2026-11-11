import { parseRequest } from "@/lib/ai";
import { allow } from "@/lib/limit";

export async function POST(request: Request) {
  const { text } = await request.json().catch(() => ({}));
  if (typeof text !== "string" || !text.trim() || text.length > 600) return Response.json({ error: "Describe the car in under 600 characters" }, { status: 400 });
  if (!allow(request, "parse", 20, 400)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
  try {
    return Response.json(await parseRequest(text));
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
