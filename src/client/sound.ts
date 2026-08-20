// Chiptune audio, zero assets: every blip and the field theme are synthesized
// with WebAudio oscillators at runtime. The AudioContext is created lazily on
// the first user gesture (autoplay policy); the BGM preference persists.

const BGM_KEY = "vouchquest.bgm";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bgmTimer: number | null = null;
let bgmStep = 0;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx || !master || freq <= 0) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(gain, start);
  env.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

const midi = (n: number): number => 440 * 2 ** ((n - 69) / 12);

export type Se = "cursor" | "confirm" | "cancel" | "coin" | "error" | "fanfare";

export function se(kind: Se): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  switch (kind) {
    case "cursor":
      tone(880, t, 0.05, "square", 0.5);
      break;
    case "confirm":
      tone(660, t, 0.06, "square", 0.5);
      tone(990, t + 0.06, 0.09, "square", 0.5);
      break;
    case "cancel":
      tone(440, t, 0.06, "square", 0.4);
      tone(330, t + 0.05, 0.1, "square", 0.4);
      break;
    case "coin":
      tone(1319, t, 0.06, "square", 0.5);
      tone(1760, t + 0.06, 0.18, "square", 0.5);
      break;
    case "error":
      tone(196, t, 0.16, "sawtooth", 0.5);
      tone(185, t + 0.16, 0.22, "sawtooth", 0.5);
      break;
    case "fanfare": {
      // Quest clear: a little rising flourish.
      const notes = [72, 76, 79, 84, 79, 84];
      notes.forEach((n, i) => tone(midi(n), t + i * 0.11, i === notes.length - 1 ? 0.5 : 0.12, "square", 0.55));
      notes.forEach((n, i) => tone(midi(n - 12), t + i * 0.11, 0.12, "triangle", 0.5));
      break;
    }
  }
}

// --- field theme: a gentle 16-bar pentatonic folk loop (eighth-note grid) ------
// 0 = rest. Written as MIDI notes; melody on triangle, bass on square.
const MELODY: readonly number[] = [
  69, 0, 72, 74, 76, 0, 74, 72, 69, 0, 67, 0, 64, 0, 67, 69,
  69, 0, 72, 74, 76, 0, 79, 76, 74, 0, 72, 0, 74, 0, 0, 0,
  76, 0, 79, 81, 79, 0, 76, 74, 72, 0, 74, 76, 74, 72, 69, 0,
  67, 0, 69, 72, 74, 0, 72, 69, 67, 0, 64, 0, 69, 0, 0, 0,
];
const BASS: readonly number[] = [
  45, 0, 52, 0, 45, 0, 52, 0, 43, 0, 50, 0, 43, 0, 50, 0,
  45, 0, 52, 0, 45, 0, 52, 0, 47, 0, 50, 0, 45, 0, 52, 0,
  48, 0, 52, 0, 48, 0, 52, 0, 45, 0, 52, 0, 45, 0, 52, 0,
  43, 0, 50, 0, 43, 0, 50, 0, 45, 0, 52, 0, 45, 0, 45, 0,
];
const STEP = 0.22; // seconds per eighth note (~136bpm eighths)

function scheduleBgm(): void {
  if (!ctx) return;
  const ahead = ctx.currentTime + 0.35;
  let next = (scheduleBgm as unknown as { next?: number }).next ?? ctx.currentTime + 0.05;
  while (next < ahead) {
    const m = MELODY[bgmStep % MELODY.length] ?? 0;
    const b = BASS[bgmStep % BASS.length] ?? 0;
    if (m > 0) tone(midi(m), next, STEP * 0.92, "triangle", 0.65);
    if (b > 0) tone(midi(b), next, STEP * 0.85, "square", 0.16);
    bgmStep++;
    next += STEP;
  }
  (scheduleBgm as unknown as { next?: number }).next = next;
}

export function bgmEnabled(): boolean {
  return (localStorage.getItem(BGM_KEY) ?? "on") === "on";
}

function startBgm(): void {
  if (bgmTimer !== null || !audio()) return;
  (scheduleBgm as unknown as { next?: number }).next = undefined;
  scheduleBgm();
  bgmTimer = window.setInterval(scheduleBgm, 150);
}

function stopBgm(): void {
  if (bgmTimer !== null) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

export function toggleBgm(): boolean {
  const next = !bgmEnabled();
  localStorage.setItem(BGM_KEY, next ? "on" : "off");
  if (next) startBgm();
  else stopBgm();
  return next;
}

/** Call on the first user gesture: unlocks audio and starts the theme if enabled. */
export function startAudio(): void {
  const a = audio();
  if (!a) return;
  if (a.state === "suspended") void a.resume();
  if (bgmEnabled()) startBgm();
}
