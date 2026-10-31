// Derives a whole color theme from a few skin colors. Used for the built-in single-look skins
// (authored into the Figma variable modes) and for the user's own skin at runtime.

export type SkinPalette = {
  background: string;
  balloon: string;
  widget: string;
  accent: string;
  /** Optional overrides; derived from the colors above for contrast when absent. */
  ink?: string;
  border?: string;
  shadow?: string;
};
export type SkinBase = "dark" | "light";
export type SkinWarning = "text" | "accent";

type Rgb = readonly [number, number, number];
type Paint = readonly [Rgb, number];

const DARK_INK: Rgb = [26, 20, 51];
const WHITE: Rgb = [255, 255, 255];

function parse(value: string): Paint | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [[(n >> 16) & 255, (n >> 8) & 255, n & 255], 1];
  }
  const rgb = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)$/.exec(value.trim());
  if (!rgb) return null;
  return [[Number(rgb[1]), Number(rgb[2]), Number(rgb[3])], rgb[4] === undefined ? 1 : Number(rgb[4])];
}

function color(value: string): Rgb {
  const paint = parse(value);
  if (!paint) throw new Error(`Invalid skin color: ${value}`);
  return paint[0];
}

function format(rgb: Rgb, alpha = 1): string {
  const channels = rgb.map((channel) => Math.round(channel)).join(" ");
  const a = Number(alpha.toFixed(3));
  return a === 1 ? `rgb(${channels})` : `rgb(${channels} / ${a})`;
}

function mix(a: Rgb, b: Rgb, weight: number): Rgb {
  return [0, 1, 2].map((i) => a[i] * weight + b[i] * (1 - weight)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two opaque colors. */
export function contrast(a: string, b: string): number {
  return ratio(color(a), color(b));
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function best(candidates: Rgb[], against: Rgb[]): Rgb {
  const score = (rgb: Rgb): number => Math.min(...against.map((other) => ratio(rgb, other)));
  return (
    candidates.find((rgb) => score(rgb) >= 4.5) ??
    [...candidates].sort((a, b) => score(b) - score(a))[0]
  );
}

/** The generated theme a skin starts from; light surfaces build on the light theme. */
export function skinBase(palette: SkinPalette): SkinBase {
  return luminance(color(palette.balloon)) > 0.35 ? "light" : "dark";
}

function resolve(base: Readonly<Record<string, string | number>>, palette: SkinPalette) {
  const background = color(palette.background);
  const balloon = color(palette.balloon);
  const widget = color(palette.widget);
  const accent = color(palette.accent);
  const window = mix(balloon, background, 0.88);
  const baseInk = color(String(base["color/ink"]));
  const ink = best(
    [...(palette.ink ? [color(palette.ink)] : []), baseInk, DARK_INK, WHITE],
    [balloon, widget, window],
  );
  const onAccent = best([WHITE, DARK_INK], [accent]);
  const accentInk = ratio(accent, balloon) >= 3 ? accent : ink;
  return {
    background,
    balloon,
    widget,
    accent,
    window,
    ink,
    onAccent,
    accentInk,
    onAccentInk: best([WHITE, DARK_INK], [accentInk]),
    border: palette.border ? color(palette.border) : null,
    shadow: palette.shadow ? color(palette.shadow) : ink,
  };
}

/** Readability problems the user should hear about before keeping a skin. */
export function skinWarnings(
  base: Readonly<Record<string, string | number>>,
  palette: SkinPalette,
): SkinWarning[] {
  const c = resolve(base, palette);
  const warnings: SkinWarning[] = [];
  if (Math.min(ratio(c.ink, c.balloon), ratio(c.ink, c.widget), ratio(c.ink, c.window)) < 4.5) {
    warnings.push("text");
  }
  if (ratio(c.accent, c.balloon) < 1.5 && ratio(c.accent, c.background) < 1.5) {
    warnings.push("accent");
  }
  return warnings;
}

/**
 * Returns every `color/*` token of `base` recolored for the skin. Tokens without a skin role
 * (categories, lists, traffic lights) keep the base value.
 */
export function deriveSkin(
  base: Readonly<Record<string, string | number>>,
  palette: SkinPalette,
): Record<string, string> {
  const c = resolve(base, palette);
  const ink2 = mix(c.ink, c.balloon, 0.74);
  const ink3 = mix(c.ink, c.balloon, 0.6);
  const border: Paint = c.border ? [c.border, 1] : [c.ink, 0.16];
  const soft = (factor: number): Paint => [border[0], border[1] * factor];
  const roles: Record<string, Paint> = {
    sky: [c.background, 1],
    "skin-sky-start": [c.background, 1],
    "skin-sky-end": [c.background, 1],
    "preview-panel": [c.balloon, 0.42],
    "preview-glow": [c.balloon, 0.7],
    "preview-glow-transparent": [c.balloon, 0],
    "sky-glow-violet": [c.balloon, 0.3],
    "sky-glow-blue": [c.balloon, 0.2],
    "document/backdrop-panel/sky": [c.background, 1],
    "document/backdrop-panel/sky-glow-violet": [c.balloon, 0.3],
    "document/backdrop-panel/sky-glow-blue": [c.balloon, 0.2],
    "document/backdrop-pill/sky": [c.background, 1],
    "document/backdrop-pill/sky-glow-violet": [c.balloon, 0.3],
    "document/backdrop-pill/sky-glow-blue": [c.balloon, 0.2],
    "glass-panel": [c.balloon, 1],
    "glass-pill": [c.balloon, 1],
    "glass-tail": [c.balloon, 1],
    "glass-capsule": [c.balloon, 1],
    "skin-play-bubble": [c.balloon, 1],
    "glass-widget": [c.widget, 1],
    "glass-window": [c.window, 1],
    sep: [c.balloon, 0.9],
    "glass-border": border,
    "glass-border-soft": soft(0.7),
    "pill-border": border,
    "capsule-border": border,
    "card-border": soft(0.8),
    "chip-border": soft(0.8),
    "input-border": soft(0.9),
    card: [c.balloon, 0.55],
    "card-2": [c.balloon, 0.45],
    chip: [c.balloon, 0.6],
    input: [c.balloon, 0.85],
    rail: [c.balloon, 0.4],
    line: [c.ink, 0.12],
    divider: [c.ink, 0.08],
    track: [c.ink, 0.12],
    "empty-cell": [c.ink, 0.07],
    hover: [c.ink, 0.05],
    pressed: [c.ink, 0.09],
    orbit: [c.ink, 0.22],
    "orbit-fill": [c.balloon, 0.22],
    ink: [c.ink, 1],
    "ink-2": [ink2, 1],
    "ink-3": [ink3, 1],
    primary: [c.accent, 1],
    "on-primary": [c.onAccent, 1],
    "primary-hover": [mix(c.accent, c.onAccent, 0.88), 1],
    "primary-pressed": [mix(c.accent, c.ink, 0.88), 1],
    selected: [c.accent, 0.16],
    "selected-ink": [c.ink, 1],
    "selected-icon": [c.accentInk, 1],
    "selected-border": [c.accentInk, 0.55],
    "seg-on": [c.balloon, 1],
    "seg-on-ink": [c.ink, 1],
    link: [c.accentInk, 1],
    "link-hover": [mix(c.accentInk, c.ink, 0.7), 1],
    "focus-ring": [c.accentInk, 1],
    "switch-on": [c.accentInk, 1],
    "check-ink": [c.onAccentInk, 1],
    "star-border": [c.accentInk, 0.5],
    connector: [c.accentInk, 0.4],
    "star-line": [c.accentInk, 0.35],
    "icon-tile": [c.accentInk, 0.1],
    "icon-tile-ink": [c.accentInk, 1],
    "document-accent": [c.accentInk, 1],
    "document/backdrop-panel/primary": [c.accentInk, 1],
    "document/backdrop-panel/accent": [c.accentInk, 1],
    "document-accent-soft-10": [c.accentInk, 0.1],
    "document-accent-soft-12": [c.accentInk, 0.12],
    "document-accent-soft-55": [c.accentInk, 0.55],
    "document-curve-highlight": [c.accentInk, 1],
    "document-panel": [c.balloon, 0.4],
    "document-highlight": [c.balloon, 0.65],
    "surface-highlight": [c.balloon, 0.7],
    "window-highlight": [c.balloon, 0.8],
    "surface-shadow": [c.shadow, 0.11],
    "pill-shadow": [c.shadow, 0.09],
    "window-shadow": [c.shadow, 0.16],
    "document-shadow": [c.shadow, 0.06],
  };
  // Remaining tokens that reuse a base role color keep their own alpha with the skin color.
  const remap = new Map<string, Rgb>();
  for (const [role, next] of [
    ["sky", c.background],
    ["ink", c.ink],
    ["ink-2", ink2],
    ["ink-3", ink3],
    ["glass-window", c.window],
    ["surface-shadow", c.shadow],
    ["primary", c.accentInk],
  ] as const) {
    const paint = parse(String(base[`color/${role}`]));
    if (paint && !remap.has(paint[0].join())) remap.set(paint[0].join(), next);
  }
  const values: Record<string, string> = {};
  for (const [path, value] of Object.entries(base)) {
    if (!path.startsWith("color/") || typeof value !== "string") continue;
    const name = path.slice("color/".length);
    const own = parse(value);
    const role = roles[name];
    const component = roles[/^component\/(.+)-alpha-\d+$/.exec(name)?.[1] ?? ""];
    const mapped = own && remap.get(own[0].join());
    if (role) values[path] = format(role[0], role[1]);
    else if (own && component) values[path] = format(component[0], own[1]);
    else if (own && mapped) values[path] = format(mapped, own[1]);
    else values[path] = value;
  }
  return values;
}
