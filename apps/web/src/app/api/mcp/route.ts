import { handleRpc } from "@/server/mcp";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless JSON responses): POST JSON-RPC here.
 * Connect a client with the URL `https://<host>/api/mcp`.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-expose-headers": "mcp-session-id",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET() {
  return Response.json({ name: "blockshot", mcp: "POST JSON-RPC (Streamable HTTP) to this URL", docs: "/llms.txt" }, { headers: CORS });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  const origin = new URL(req.url).origin;
  const batch = Array.isArray(body);
  const msgs: unknown[] = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(msgs.map((m) => handleRpc(m as never, origin)))).filter((x) => x !== null);
  if (replies.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(batch ? replies : replies[0], { headers: CORS });
}
