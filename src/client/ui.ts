// Dragon Quest-style windows: black panels, double white borders, a blinking ▶
// cursor. All widgets live on a stack — the top one owns the keyboard.

export const FONT = '20px "DotGothic16", "Hiragino Kaku Gothic ProN", monospace';
const BORDER = "#f8f8f8";
const PANEL = "#000814";

export function drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = "#ffffff"): void {
  ctx.font = FONT;
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

export interface Widget {
  handleKey(key: string): void;
  render(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}

export interface MenuItem {
  readonly label: string;
  readonly value: string;
  readonly disabled?: boolean;
}

export class Menu implements Widget {
  private cursor = 0;
  constructor(
    private readonly title: string,
    private readonly items: readonly MenuItem[],
    private readonly onSelect: (value: string) => void,
    private readonly onCancel: () => void,
  ) {}

  handleKey(key: string): void {
    if (key === "ArrowUp" || key === "w") this.cursor = (this.cursor + this.items.length - 1) % this.items.length;
    else if (key === "ArrowDown" || key === "s") this.cursor = (this.cursor + 1) % this.items.length;
    else if (key === "Enter" || key === " " || key === "z") {
      const item = this.items[this.cursor];
      if (item && !item.disabled) this.onSelect(item.value);
    } else if (key === "Escape" || key === "x") this.onCancel();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.font = FONT;
    const widest = Math.max(ctx.measureText(this.title).width, ...this.items.map((i) => ctx.measureText(i.label).width));
    const w = Math.min(Math.max(widest + 76, 220), 560);
    const h = 58 + this.items.length * 30;
    const x = 40;
    const y = 40;
    drawWindow(ctx, x, y, w, h);
    drawText(ctx, this.title, x + 24, y + 18, "#ffd75e");
    this.items.forEach((item, i) => {
      const rowY = y + 50 + i * 30;
      if (i === this.cursor && Math.floor(performance.now() / 400) % 2 === 0) drawText(ctx, "▶", x + 20, rowY);
      drawText(ctx, item.label, x + 48, rowY, item.disabled ? "#777777" : "#ffffff");
    });
  }
}

export class TextInput implements Widget {
  private value = "";
  constructor(
    private readonly prompt: string,
    private readonly opts: { numeric?: boolean; lowercase?: boolean; maxLen?: number },
    private readonly onSubmit: (value: string) => void,
    private readonly onCancel: () => void,
  ) {}

  handleKey(key: string): void {
    if (key === "Enter") {
      if (this.value.length > 0) this.onSubmit(this.value);
      return;
    }
    if (key === "Escape") return this.onCancel();
    if (key === "Backspace") {
      this.value = this.value.slice(0, -1);
      return;
    }
    if (key.length !== 1) return;
    const ok = this.opts.numeric ? /[0-9]/.test(key) : /[A-Za-z0-9]/.test(key);
    if (!ok) return;
    const next = this.value + (this.opts.lowercase ? key.toLowerCase() : key);
    if (next.length <= (this.opts.maxLen ?? 24)) this.value = next;
  }

  render(ctx: CanvasRenderingContext2D, width: number): void {
    const w = 520;
    const x = (width - w) / 2;
    const y = 120;
    drawWindow(ctx, x, y, w, 130);
    drawText(ctx, this.prompt, x + 24, y + 20, "#ffd75e");
    const blink = Math.floor(performance.now() / 400) % 2 === 0 ? "▁" : " ";
    drawText(ctx, `＞ ${this.value}${blink}`, x + 24, y + 62);
    drawText(ctx, "Enter:けってい  Esc:やめる", x + 24, y + 96, "#9ab");
  }
}

export class Info implements Widget {
  private top = 0;
  constructor(
    private readonly title: string,
    private readonly lines: readonly string[],
    private readonly onClose: () => void,
  ) {}

  handleKey(key: string): void {
    const pageRows = 10;
    if (key === "ArrowDown" || key === "s") this.top = Math.min(this.top + 1, Math.max(0, this.lines.length - pageRows));
    else if (key === "ArrowUp" || key === "w") this.top = Math.max(0, this.top - 1);
    else if (key === "Enter" || key === "Escape" || key === " " || key === "z" || key === "x") this.onClose();
  }

  render(ctx: CanvasRenderingContext2D, width: number): void {
    const w = Math.min(640, width - 80);
    const x = (width - w) / 2;
    const y = 56;
    const pageRows = 10;
    const rows = this.lines.slice(this.top, this.top + pageRows);
    drawWindow(ctx, x, y, w, 84 + pageRows * 26);
    drawText(ctx, this.title, x + 24, y + 18, "#ffd75e");
    rows.forEach((line, i) => drawText(ctx, line, x + 24, y + 52 + i * 26));
    if (this.lines.length > pageRows) drawText(ctx, `↑↓ (${this.top + 1}/${this.lines.length})`, x + w - 150, y + 18, "#9ab");
  }
}

export class MessageLog {
  private readonly messages: string[] = [];

  push(message: string): void {
    for (const chunk of wrap(message, 40)) this.messages.push(chunk);
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const h = 128;
    drawWindow(ctx, 12, height - h - 12, width - 24, h);
    const recent = this.messages.slice(-4);
    recent.forEach((line, i) => drawText(ctx, line, 36, height - h + 8 + i * 27));
  }
}

function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > cols) {
    out.push(rest.slice(0, cols));
    rest = rest.slice(cols);
  }
  out.push(rest);
  return out;
}

export class UiStack {
  private readonly stack: Widget[] = [];

  get active(): boolean {
    return this.stack.length > 0;
  }

  push(widget: Widget): void {
    this.stack.push(widget);
  }

  pop(): void {
    this.stack.pop();
  }

  clear(): void {
    this.stack.length = 0;
  }

  handleKey(key: string): boolean {
    const top = this.stack[this.stack.length - 1];
    if (!top) return false;
    top.handleKey(key);
    return true;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    for (const widget of this.stack) widget.render(ctx, width, height);
  }
}
