// Ambience: the layer that makes the world feel alive without touching it.
// Particles celebrate real events, birds and butterflies fill the quiet, and a
// day-night tint follows the player's real clock. Pure presentation — nothing
// here reads or writes world state.

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
}

export class ParticleField {
  private readonly list: Particle[] = [];

  /** A firework burst in world pixels — for foundings and other big news. */
  firework(x: number, y: number): void {
    const colors = ["#ffd75e", "#ff6a5e", "#6ad2ff", "#a5ff8a", "#ff9de2"];
    for (let burst = 0; burst < 3; burst++) {
      const bx = x + (burst - 1) * 40;
      const by = y - burst * 26;
      const color = colors[(burst * 2) % colors.length] ?? "#ffd75e";
      for (let i = 0; i < 26; i++) {
        const angle = (Math.PI * 2 * i) / 26;
        const speed = 1.2 + Math.random() * 1.6;
        this.list.push({
          x: bx,
          y: by,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 900 + burst * 250 + Math.random() * 300,
          maxLife: 1400,
          color,
          size: 4,
          gravity: 0.02,
        });
      }
    }
  }

  /** A soft upward sparkle in world pixels — trades, vouches, mints. */
  sparkle(x: number, y: number, color = "#ffd75e"): void {
    for (let i = 0; i < 10; i++) {
      this.list.push({
        x: x + Math.random() * 48,
        y: y + Math.random() * 24,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.5 - Math.random() * 0.8,
        life: 700 + Math.random() * 400,
        maxLife: 1100,
        color,
        size: 3,
        gravity: 0,
      });
    }
  }

  /** Falling festival confetti in world pixels. */
  confetti(x: number, y: number): void {
    const colors = ["#ff6a5e", "#ffd75e", "#6ad2ff", "#a5ff8a", "#ff9de2", "#ffffff"];
    this.list.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 0.4 + Math.random() * 0.6,
      life: 1600,
      maxLife: 1600,
      color: colors[Math.floor(Math.random() * colors.length)] ?? "#ffd75e",
      size: 3,
      gravity: 0.01,
    });
  }

  update(dt: number): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (!p) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.x += p.vx * (dt / 16.7);
      p.y += p.vy * (dt / 16.7);
      p.vy += p.gravity * (dt / 16.7);
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.maxLife));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - camX, p.y - camY, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}

// --- birds and butterflies ----------------------------------------------------

interface Bird {
  x: number;
  y: number;
  vx: number;
}

interface Butterfly {
  x: number;
  y: number;
  phase: number;
  homeX: number;
  homeY: number;
}

export class Wildlife {
  private readonly birds: Bird[] = [];
  private readonly butterflies: Butterfly[] = [];
  private birdTimer = 3000;

  /** Seed butterflies at (world-pixel) flower positions; call after a map build. */
  seedButterflies(flowers: readonly (readonly [number, number])[]): void {
    this.butterflies.length = 0;
    const picks = [...flowers].sort(() => Math.random() - 0.5).slice(0, 14);
    for (const [fx, fy] of picks) {
      this.butterflies.push({ x: fx, y: fy, phase: Math.random() * Math.PI * 2, homeX: fx, homeY: fy });
    }
  }

  update(dt: number, viewW: number, viewH: number, camX: number, camY: number): void {
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 6000 + Math.random() * 9000;
      const leftToRight = Math.random() < 0.5;
      this.birds.push({
        x: camX + (leftToRight ? -30 : viewW + 30),
        y: camY + 30 + Math.random() * (viewH * 0.5),
        vx: (leftToRight ? 1 : -1) * (1.6 + Math.random()),
      });
    }
    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i];
      if (!b) continue;
      b.x += b.vx * (dt / 16.7);
      if (b.x < camX - 80 || b.x > camX + viewW + 80) this.birds.splice(i, 1);
    }
    for (const f of this.butterflies) {
      f.phase += dt / 300;
      f.x = f.homeX + Math.cos(f.phase) * 20 + Math.sin(f.phase * 2.3) * 8;
      f.y = f.homeY + Math.sin(f.phase * 1.7) * 14;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const flap = Math.floor(performance.now() / 180) % 2;
    ctx.fillStyle = "#222";
    for (const b of this.birds) {
      const x = b.x - camX;
      const y = b.y - camY;
      if (flap === 0) {
        ctx.fillRect(x - 5, y - 3, 4, 2);
        ctx.fillRect(x + 1, y - 3, 4, 2);
        ctx.fillRect(x - 2, y - 1, 4, 2);
      } else {
        ctx.fillRect(x - 5, y, 4, 2);
        ctx.fillRect(x + 1, y, 4, 2);
        ctx.fillRect(x - 2, y - 1, 4, 2);
      }
    }
    for (const f of this.butterflies) {
      const x = f.x - camX;
      const y = f.y - camY;
      const open = Math.floor(performance.now() / 140 + f.phase * 10) % 2 === 0;
      ctx.fillStyle = "#ffd6f0";
      if (open) {
        ctx.fillRect(x - 3, y, 3, 3);
        ctx.fillRect(x + 1, y, 3, 3);
      } else {
        ctx.fillRect(x - 1, y, 3, 3);
      }
    }
  }
}

// --- day-night ------------------------------------------------------------------

export interface DayPhase {
  readonly tint: string | null;
  readonly night: boolean;
  readonly label: string;
}

/** The player's real clock sets the mood: dusk, lamplit night, dawn, day. */
export function dayPhase(now = new Date()): DayPhase {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 19 || h < 5) return { tint: "rgba(12, 14, 60, 0.38)", night: true, label: "よる" };
  if (h >= 17) return { tint: "rgba(255, 120, 40, 0.16)", night: false, label: "ゆうぐれ" };
  if (h < 6.5) return { tint: "rgba(140, 150, 220, 0.20)", night: false, label: "よあけ" };
  return { tint: null, night: false, label: "ひるま" };
}

// --- weather: each biome breathes differently -----------------------------------

import { Biome } from "./map";

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  color: string;
  size: number;
}

export class Weather {
  private readonly drops: Drop[] = [];

  update(dt: number, biome: Biome, night: boolean, viewW: number, viewH: number): void {
    const want =
      biome === Biome.Snow ? 60 : biome === Biome.Forest ? 14 : biome === Biome.Desert ? 10 : biome === Biome.Swamp && night ? 18 : 0;
    while (this.drops.length < want) {
      if (biome === Biome.Snow) {
        this.drops.push({ x: Math.random() * viewW, y: -8, vx: -0.3 - Math.random() * 0.4, vy: 0.7 + Math.random() * 0.8, phase: Math.random() * 6, color: "#ffffff", size: 3 });
      } else if (biome === Biome.Forest) {
        this.drops.push({ x: Math.random() * viewW, y: -8, vx: 0.3 - Math.random() * 0.6, vy: 0.4 + Math.random() * 0.4, phase: Math.random() * 6, color: Math.random() < 0.5 ? "#7bc44a" : "#d9a53f", size: 3 });
      } else if (biome === Biome.Desert) {
        this.drops.push({ x: -10, y: Math.random() * viewH, vx: 3 + Math.random() * 2.5, vy: 0.1, phase: Math.random() * 6, color: "rgba(232, 204, 130, 0.7)", size: 2 });
      } else {
        this.drops.push({ x: Math.random() * viewW, y: Math.random() * viewH, vx: 0, vy: 0, phase: Math.random() * 6, color: "#b8ff6a", size: 3 });
      }
    }
    if (this.drops.length > want) this.drops.splice(0, this.drops.length - want);
    for (const d of this.drops) {
      d.phase += dt / 400;
      if (biome === Biome.Swamp) {
        // fireflies drift and blink in place
        d.x += Math.cos(d.phase) * 0.4;
        d.y += Math.sin(d.phase * 1.3) * 0.3;
      } else {
        d.x += (d.vx + Math.sin(d.phase) * 0.3) * (dt / 16.7);
        d.y += d.vy * (dt / 16.7);
      }
      if (d.y > viewH + 10) {
        d.y = -8;
        d.x = Math.random() * viewW;
      }
      if (d.x > viewW + 12) {
        d.x = -10;
        d.y = Math.random() * viewH;
      }
      if (d.x < -12) d.x = viewW + 8;
    }
  }

  render(ctx: CanvasRenderingContext2D, biome: Biome): void {
    for (const d of this.drops) {
      if (biome === Biome.Swamp) {
        const blink = (Math.sin(d.phase * 2.2) + 1) / 2;
        if (blink < 0.35) continue;
        ctx.globalAlpha = blink;
      }
      ctx.fillStyle = d.color;
      ctx.fillRect(d.x, d.y, d.size, d.size);
      ctx.globalAlpha = 1;
    }
  }
}

// --- the sky: shooting stars, aurora over the snowfields, the odd rainbow -------

interface Streak {
  x: number;
  y: number;
  life: number;
}

export class SkyShow {
  private readonly stars: Streak[] = [];
  private starTimer = 8000;

  update(dt: number, night: boolean): void {
    if (night) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) {
        this.starTimer = 9000 + Math.random() * 22000;
        this.stars.push({ x: 100 + Math.random() * 700, y: 20 + Math.random() * 120, life: 700 });
      }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      if (!s) continue;
      s.life -= dt;
      s.x += dt * 0.35;
      s.y += dt * 0.18;
      if (s.life <= 0) this.stars.splice(i, 1);
    }
  }

  render(ctx: CanvasRenderingContext2D, w: number, night: boolean, snowBiome: boolean): void {
    for (const s of this.stars) {
      ctx.globalAlpha = Math.min(1, s.life / 400);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - 26, s.y - 13);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Aurora: slow translucent bands over the snowfields at night.
    if (night && snowBiome) {
      const t = performance.now() / 3000;
      for (let band = 0; band < 3; band++) {
        ctx.globalAlpha = 0.10 + 0.05 * Math.sin(t + band);
        ctx.fillStyle = band % 2 === 0 ? "#5affc3" : "#b48aff";
        ctx.beginPath();
        for (let x = 0; x <= w; x += 24) {
          const y = 40 + band * 34 + Math.sin(t + x / 90 + band * 2) * 18;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let x = w; x >= 0; x -= 24) {
          const y = 40 + band * 34 + Math.sin(t + x / 90 + band * 2) * 18 + 22;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // A rainbow hour, now and then, while the sun is up.
    if (!night && Math.floor(Date.now() / 3_600_000) % 5 === 0) {
      const colors = ["#e05050", "#e0a050", "#e0d850", "#50c060", "#5080e0", "#8a5ae0"];
      colors.forEach((c, i) => {
        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = c;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(w - 160, 180, 130 - i * 7, Math.PI, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
  }
}
