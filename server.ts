// vouch-quest game server. Serves the pixel client and bridges it to a vouch-node:
// reads are proxied, writes are signed locally with the wallet key (non-custodial —
// the browser never sees the key, the node never sees anything unsigned).
//
//   VOUCH_NODE_URL   node base URL (default http://127.0.0.1:8787 — the SSH tunnel)
//   QUEST_PORT       game port (default 5178)
//   VOUCH_CONFIG_DIR / VOUCH_KEYFILE  wallet location (shared with vouch-cli)

import { VouchClient } from "vouch-cli";
import indexHtml from "./public/index.html";
import { actionSchema, dispatchAction, findHeroAgent } from "./src/server/act";
import { buildSnapshot } from "./src/server/snapshot";
import { loadWallet, saveHeroName } from "./src/server/wallet";
import type { AgentView } from "./src/shared";

const NODE_URL = process.env["VOUCH_NODE_URL"] ?? "http://127.0.0.1:8787";
const PORT = Number(process.env["QUEST_PORT"] ?? 5178);

let wallet = loadWallet(process.env);
const client = new VouchClient(NODE_URL, wallet.keyPair);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function handleRegister(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { heroName?: string } | null;
  const heroName = body?.heroName;
  if (typeof heroName !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(heroName) || heroName.length > 64) {
    return json({ ok: false, reason: "hero name must be letters then alphanumerics (e.g. Mizuki)" }, 400);
  }
  const res = await client.register(heroName);
  if (!res.ok) {
    // Registration is first-writer-wins on the node, even for the same key. A taken
    // name from THIS machine's key cannot be verified from here — if it is yours from
    // another machine, copy that machine's ~/.vouch wallet over instead.
    const reason = res.reason === "already-registered" ? "そのなまえは すでに つかわれている" : res.reason;
    return json({ ok: false, reason }, res.status);
  }
  saveHeroName(process.env, heroName);
  wallet = { ...wallet, heroName };
  return json({ ok: true, heroName });
}

async function handleAct(req: Request): Promise<Response> {
  if (!wallet.heroName) return json({ ok: false, reason: "no hero yet — name your hero first" }, 400);
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return json({ ok: false, reason: parsed.error.issues[0]?.message ?? "bad action" }, 400);
  const agents = (await client.agents()) as AgentView[];
  const hero = { heroName: wallet.heroName, agentId: findHeroAgent(agents, wallet.heroName)?.id ?? null };
  try {
    const result = await dispatchAction(client, hero, parsed.data);
    return json(result, result.ok ? 200 : 422);
  } catch (error) {
    return json({ ok: false, reason: error instanceof Error ? error.message : String(error) }, 502);
  }
}

const server = Bun.serve({
  port: PORT,
  routes: {
    "/": indexHtml,
    "/api/world": async () => {
      try {
        return json(await buildSnapshot(client, wallet.heroName));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502);
      }
    },
    "/api/log": async (req: Request) => {
      const since = Number(new URL(req.url).searchParams.get("since") ?? "0");
      try {
        return json(await client.log(Number.isFinite(since) && since >= 0 ? since : 0));
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 502);
      }
    },
    "/api/register": { POST: handleRegister },
    "/api/act": { POST: handleAct },
  },
  fetch: () => new Response("not found", { status: 404 }),
});

console.log(`vouch-quest: http://localhost:${server.port}  (node: ${NODE_URL}, hero: ${wallet.heroName ?? "unnamed"})`);
