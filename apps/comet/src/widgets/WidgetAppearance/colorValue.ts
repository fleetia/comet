// Parses typed hex, rgb() and hsl() colors into the #rrggbb value widgets store.
type ParsedColor = {
  alpha: number;
  blue: number;
  green: number;
  red: number;
};

type FunctionalColorParts = {
  alpha?: string;
  channels: readonly [string, string, string];
};

const HEX_COLOR_PATTERN = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
const HUE_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function parseFiniteNumber(value: string): number | null {
  const trimmedValue = value.trim();

  if (!NUMBER_PATTERN.test(trimmedValue)) {
    return null;
  }

  const parsedValue = Number(trimmedValue);

  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseFunctionalParts(value: string): FunctionalColorParts | null {
  if (value.includes(",")) {
    if (value.includes("/")) {
      return null;
    }

    const parts = value.split(",").map((part) => part.trim());

    if (parts.length !== 3 && parts.length !== 4) {
      return null;
    }

    const [first, second, third, alpha] = parts;

    if (!first || !second || !third) {
      return null;
    }

    return { alpha, channels: [first, second, third] };
  }

  const slashParts = value.split("/").map((part) => part.trim());

  if (slashParts.length > 2) {
    return null;
  }

  if (slashParts.length === 2 && !slashParts[1]) {
    return null;
  }

  const channels = slashParts[0]?.split(/\s+/).filter(Boolean) ?? [];

  if (channels.length !== 3) {
    return null;
  }

  const [first, second, third] = channels;

  if (!first || !second || !third) {
    return null;
  }

  return {
    alpha: slashParts[1] || undefined,
    channels: [first, second, third],
  };
}

function parseRgbChannel(value: string): number | null {
  const isPercentage = value.endsWith("%");
  const numericValue = parseFiniteNumber(
    isPercentage ? value.slice(0, -1) : value,
  );

  if (numericValue === null) {
    return null;
  }

  const channelValue = isPercentage
    ? (numericValue / 100) * 255
    : numericValue;

  return Math.round(clamp(channelValue, 0, 255));
}

function parsePercentage(value: string): number | null {
  if (!value.endsWith("%")) {
    return null;
  }

  const numericValue = parseFiniteNumber(value.slice(0, -1));

  if (numericValue === null) {
    return null;
  }

  return clamp(numericValue / 100, 0, 1);
}

function parseAlpha(value: string | undefined): number | null {
  if (value === undefined) {
    return 1;
  }

  if (value.endsWith("%")) {
    return parsePercentage(value);
  }

  const numericValue = parseFiniteNumber(value);

  return numericValue === null ? null : clamp(numericValue, 0, 1);
}

function parseHue(value: string): number | null {
  const match = HUE_PATTERN.exec(value.trim());

  if (!match) {
    return null;
  }

  const numericValue = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  let degrees = numericValue;

  switch (unit) {
    case "grad":
      degrees = numericValue * 0.9;
      break;
    case "rad":
      degrees = numericValue * (180 / Math.PI);
      break;
    case "turn":
      degrees = numericValue * 360;
      break;
    default:
      break;
  }

  return ((degrees % 360) + 360) % 360;
}

function parseHexColor(value: string): ParsedColor | null {
  const match = HEX_COLOR_PATTERN.exec(value);
  const hexValue = match?.[1];

  if (!hexValue) {
    return null;
  }

  const expandedValue = hexValue.length <= 4
    ? [...hexValue].map((character) => character.repeat(2)).join("")
    : hexValue;
  const hasAlpha = expandedValue.length === 8;

  return {
    alpha: hasAlpha
      ? Number.parseInt(expandedValue.slice(6, 8), 16) / 255
      : 1,
    blue: Number.parseInt(expandedValue.slice(4, 6), 16),
    green: Number.parseInt(expandedValue.slice(2, 4), 16),
    red: Number.parseInt(expandedValue.slice(0, 2), 16),
  };
}

function parseRgbColor(value: string): ParsedColor | null {
  const match = /^rgba?\((.*)\)$/i.exec(value);
  const parts = match ? parseFunctionalParts(match[1] ?? "") : null;

  if (!parts) {
    return null;
  }

  const [redValue, greenValue, blueValue] = parts.channels;
  const red = parseRgbChannel(redValue);
  const green = parseRgbChannel(greenValue);
  const blue = parseRgbChannel(blueValue);
  const alpha = parseAlpha(parts.alpha);

  if (red === null || green === null || blue === null || alpha === null) {
    return null;
  }

  return { alpha, blue, green, red };
}

function convertHslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): Pick<ParsedColor, "blue" | "green" | "red"> {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hueSection < 1) {
    red = chroma;
    green = secondary;
  } else if (hueSection < 2) {
    red = secondary;
    green = chroma;
  } else if (hueSection < 3) {
    green = chroma;
    blue = secondary;
  } else if (hueSection < 4) {
    green = secondary;
    blue = chroma;
  } else if (hueSection < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const lightnessMatch = lightness - chroma / 2;

  return {
    blue: Math.round((blue + lightnessMatch) * 255),
    green: Math.round((green + lightnessMatch) * 255),
    red: Math.round((red + lightnessMatch) * 255),
  };
}

function parseHslColor(value: string): ParsedColor | null {
  const match = /^hsla?\((.*)\)$/i.exec(value);
  const parts = match ? parseFunctionalParts(match[1] ?? "") : null;

  if (!parts) {
    return null;
  }

  const [hueValue, saturationValue, lightnessValue] = parts.channels;
  const hue = parseHue(hueValue);
  const saturation = parsePercentage(saturationValue);
  const lightness = parsePercentage(lightnessValue);
  const alpha = parseAlpha(parts.alpha);

  if (
    hue === null ||
    saturation === null ||
    lightness === null ||
    alpha === null
  ) {
    return null;
  }

  return { alpha, ...convertHslToRgb(hue, saturation, lightness) };
}

function parseColor(value: string): ParsedColor | null {
  const normalizedInput = value.trim().toLowerCase();

  if (normalizedInput.startsWith("#")) {
    return parseHexColor(normalizedInput);
  }

  if (normalizedInput.startsWith("rgb")) {
    return parseRgbColor(normalizedInput);
  }

  if (normalizedInput.startsWith("hsl")) {
    return parseHslColor(normalizedInput);
  }

  return null;
}

function toHexByte(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

export function normalizeColor(value: string): string | null {
  const color = parseColor(value);

  if (!color) {
    return null;
  }

  return `#${toHexByte(color.red)}${toHexByte(color.green)}${toHexByte(color.blue)}`;
}
