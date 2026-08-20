// Tiny read-only content server: serves the genome the evolution daemon grows,
// so the Vercel-hosted game can fetch it via the /genome rewrite. GET only.
import { readFileSync } from "node:fs";

const GENOME_PATH = process.env["GENOME_PATH"] ?? `${process.env["HOME"]}/vouch-data/genome.json`;
const PORT = Number(process.env["GENOME_PORT"] ?? 8788);

const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60",
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req: Request): Response {
    const url = new URL(req.url);
    if (req.method !== "GET") return new Response("read-only", { status: 405 });
    if (url.pathname === "/genome.json" || url.pathname === "/genome") {
      try {
        return new Response(readFileSync(GENOME_PATH, "utf8"), { headers: HEADERS });
      } catch {
        return new Response("{}", { headers: HEADERS });
      }
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`genome server on :${PORT} (${GENOME_PATH})`);
