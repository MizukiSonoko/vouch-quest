// Dev server: serves the game shell (Bun bundles the client TS on the fly) and
// proxies `/node/*` to a vouch-node so the browser stays same-origin (no CORS).
// Signing happens IN THE BROWSER — this process holds no keys and has no write
// API of its own. Production does not run this file: Vercel serves the static
// build and a rewrite plays the proxy role (see vercel.json).
//
//   VOUCH_NODE_URL   node base URL (default http://127.0.0.1:8787 — the SSH tunnel)
//   QUEST_PORT       game port (default 5178)

import indexHtml from "../public/index.html";

const NODE_URL = (process.env["VOUCH_NODE_URL"] ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const PORT = Number(process.env["QUEST_PORT"] ?? 5178);

const server = Bun.serve({
  port: PORT,
  routes: {
    "/": indexHtml,
  },
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/node/") || url.pathname === "/node") {
      const target = `${NODE_URL}${url.pathname.replace(/^\/node/, "") || "/"}${url.search}`;
      try {
        const upstream = await fetch(target, {
          method: req.method,
          headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
          body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
        });
        return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "proxy failed" }), {
          status: 502,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`vouch-quest (dev): http://localhost:${server.port}  → node: ${NODE_URL}`);
