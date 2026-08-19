# vouch quest

A **Dragon Quest I-style 2D pixel client** for a live [vouch](../vouch) world.
Villages are regions, villagers are agents, the treasure chest is the treasury —
and everything you do in the game is a **real Ed25519-signed command** against a
running `vouch-node`. Nothing is simulated client-side: the world state you walk
through is the node's event-sourced state, and the message window at the bottom
is the world log, live.

| in the game | on the node |
|---|---|
| founding a village | `found` (+ auto `admit` of your hero) |
| talking to a villager, handing over gold | `transfer` (fees to the village treasury) |
| ほしょうする | `vouch` (weight 1–5, raises trust) |
| handing over an item | `transfer-item` |
| the village signboard | institutions: govern, migrate, vote, mint, admit |
| おきてを かえる | `amend` (dictatorship only, by design) |
| the newspaper window | `GET /log` polled every 2.5s |

## Architecture

```
browser (canvas, zero assets — all pixel art procedural)
   │  Ed25519 key in localStorage; EVERY command signed IN the browser
   │  reads + writes go to same-origin /node/*
   ▼
/node proxy — dev: server.ts (Bun), prod: a Vercel rewrite. Holds no keys.
   ▼
vouch-node (dev: SSH tunnel on 127.0.0.1:8787, prod: the public node URL)
```

**Multiplayer, non-custodial:** each visitor gets their own Ed25519 seed
(generated into localStorage on first load) and registers their own hero. One key
signs for two principals: the hero name (region owner / governance) and
`hero@region` (the agent that trades). No server ever sees a key — byte-parity
with the node's signed formats is pinned by `test/wire.test.ts`.

## Run

Requires [Bun](https://bun.sh) and a reachable vouch-node. The sibling checkout
`../vouch` provides the SDK via `file:` dependencies.

```bash
# 1. tunnel to your node (or point VOUCH_NODE_URL somewhere else)
ssh -N -L 8787:127.0.0.1:8787 node@<your-node>

# 2. install & start
bun install
bun dev            # http://localhost:5178
bun run build      # static dist/ for Vercel (rewrites /node/* to your public node)

# checks
bun run typecheck && bun test
```

Env: `VOUCH_NODE_URL` (default `http://127.0.0.1:8787`), `QUEST_PORT` (default
`5178`), `VOUCH_CONFIG_DIR` / `VOUCH_KEYFILE` (wallet location, shared with the CLI).

## Controls

| key | action |
|---|---|
| arrows / WASD | walk |
| Enter / Space / Z | talk・examine・command menu |
| Esc / X | cancel |
| ↑↓ | menu cursor |

First run: name your hero (romaji), then open the command menu on empty land and
**むらを たてる** — region ids are lowercase alphanumerics, permanent, and yours.

## Honesty rules

- **Everything is permanent.** A founded village, a registered name, a transfer —
  the node's journal never forgets. The game adds no undo because there is none.
- **The game holds no authority.** It picks which of your principals signs; the
  node's authorization and the region's institutions decide what actually happens.
  A rejection (e.g. minting in a village whose rules say owner-only) is shown as-is.
- **Reads are the observation surface.** The game can watch the world but cannot
  mutate it outside the signed command path.
