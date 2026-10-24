import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const themeNames = ["dark", "light", "paper", "play"];
const supportedTypes = new Set(["COLOR", "FLOAT", "TIMING", "STRING"]);
const owns = (object, key) => Object.hasOwn(object, key);

function number(value) {
  return Number(value.toFixed(6));
}

function customProperty(path) {
  const segments = path.split("/").map((segment) =>
    segment
      .normalize("NFC")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .replace(/\s+/gu, "-")
      .toLowerCase(),
  );
  if (segments.some((segment) => !/^[\p{L}\p{N}_-]+$/u.test(segment))) {
    throw new Error(`Invalid token path: ${path}`);
  }
  return `--comet-${segments.join("-")}`;
}

function modesFor(collection) {
  const modes = collection.modes;
  if (!Array.isArray(modes) || modes.length === 0) {
    throw new Error(`Missing modes: ${collection.name}`);
  }
  if (new Set(modes.map((mode) => mode.modeId)).size !== modes.length) {
    throw new Error(`Duplicate mode ID: ${collection.name}`);
  }
  if (!modes.some((mode) => mode.modeId === collection.defaultModeId)) {
    throw new Error(`Missing default mode: ${collection.name}`);
  }
  if (modes.length === 1) {
    return Object.fromEntries(themeNames.map((theme) => [theme, modes[0].modeId]));
  }
  if (modes.length !== themeNames.length) {
    throw new Error(`Expected shared or ${themeNames.join("/")} modes: ${collection.name}`);
  }
  return Object.fromEntries(
    themeNames.map((theme) => {
      const matching = modes.filter((mode) =>
        new RegExp(`^${theme}(?:\\s|[·_-]|$)`, "i").test(mode.name),
      );
      if (matching.length !== 1) {
        throw new Error(`Missing or ambiguous ${theme} mode: ${collection.name}`);
      }
      return [theme, matching[0].modeId];
    }),
  );
}

function scalar(variable, value) {
  if (variable.type === "STRING" && typeof value === "string") return value;
  if (
    ["FLOAT", "TIMING"].includes(variable.type) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return number(value);
  }
  if (variable.type === "COLOR" && value && typeof value === "object") {
    const { r, g, b, a = 1 } = value;
    if (
      [r, g, b, a].every(
        (channel) =>
          typeof channel === "number" && Number.isFinite(channel) && channel >= 0 && channel <= 1,
      )
    ) {
      const rgb = [r, g, b].map((channel) => {
        const scaled = channel * 255;
        return Math.abs(scaled - Math.round(scaled)) < 0.0001 ? Math.round(scaled) : number(scaled);
      });
      const alpha = number(a);
      return `rgb(${rgb.join(" ")}${alpha === 1 ? "" : ` / ${alpha}`})`;
    }
  }
  throw new Error(`Invalid ${variable.type} value: ${variable.name}`);
}

function cssValue(variable, value) {
  if (typeof value !== "number") return value;
  const [group] = variable.name.split("/");
  if (
    ["spacing", "radius", "size"].includes(group) ||
    /\/(fontSize|lineHeight)$/.test(variable.name)
  ) {
    return `${value}px`;
  }
  if (group === "duration" || variable.type === "TIMING") return `${value}s`;
  return String(value);
}

export function buildTokenArtifacts(source) {
  if (!Array.isArray(source.collections) || !Array.isArray(source.variables)) {
    throw new Error("Expected Figma collections and variables");
  }
  const collections = new Map();
  for (const collection of source.collections) {
    if (collections.has(collection.id))
      throw new Error(`Duplicate collection ID: ${collection.id}`);
    collections.set(collection.id, modesFor(collection));
  }

  const variables = [...source.variables].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  const byId = new Map();
  const properties = new Map();
  const tokenNames = {};
  for (const variable of variables) {
    if (byId.has(variable.id)) throw new Error(`Duplicate variable ID: ${variable.id}`);
    if (!collections.has(variable.collectionId))
      throw new Error(`Missing collection: ${variable.name}`);
    if (!supportedTypes.has(variable.type))
      throw new Error(`Unsupported variable type: ${variable.type}`);
    const property = customProperty(variable.name);
    if (properties.has(property)) {
      throw new Error(
        `CSS property collision: ${properties.get(property)} and ${variable.name} -> ${property}`,
      );
    }
    const collection = source.collections.find((item) => item.id === variable.collectionId);
    const modeIds = collection.modes.map((mode) => mode.modeId);
    if (!variable.valuesByMode || modeIds.some((id) => !owns(variable.valuesByMode, id))) {
      throw new Error(`Missing mode value: ${variable.name}`);
    }
    if (Object.keys(variable.valuesByMode).some((id) => !modeIds.includes(id))) {
      throw new Error(`Unknown mode value: ${variable.name}`);
    }
    properties.set(property, variable.name);
    tokenNames[variable.name] = property;
    byId.set(variable.id, variable);
  }

  function resolve(variable, theme, trail = new Set()) {
    if (trail.has(variable.id)) throw new Error(`Alias cycle: ${variable.name}`);
    const mode = collections.get(variable.collectionId)[theme];
    const value = variable.valuesByMode[mode];
    if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
      const target = byId.get(value.id);
      if (!target) throw new Error(`Missing alias ${value.id}: ${variable.name}`);
      if (target.type !== variable.type) throw new Error(`Alias type mismatch: ${variable.name}`);
      return resolve(target, theme, new Set([...trail, variable.id]));
    }
    return scalar(variable, value);
  }

  const themes = Object.fromEntries(
    themeNames.map((theme) => [
      theme,
      Object.fromEntries(variables.map((variable) => [variable.name, resolve(variable, theme)])),
    ]),
  );
  const shared = variables.filter(
    (variable) =>
      source.collections.find((collection) => collection.id === variable.collectionId).modes
        .length === 1 &&
      themeNames.every((theme) => themes[theme][variable.name] === themes.dark[variable.name]),
  );
  const themed = variables.filter((variable) => !shared.includes(variable));
  const declarations = (items, theme) =>
    items
      .map(
        (variable) =>
          `  ${tokenNames[variable.name]}: ${cssValue(variable, themes[theme][variable.name])};`,
      )
      .join("\n");
  const css =
    [
      "/* Generated from figma/variables.json. Run pnpm --filter @comet/token generate. */",
      `:root {\n${declarations(shared, "dark")}\n}`,
      ...themeNames.map(
        (theme) => `[data-comet-theme="${theme}"] {\n${declarations(themed, theme)}\n}`,
      ),
    ].join("\n\n") + "\n";
  const typescript = `// Generated from figma/variables.json. Run pnpm --filter @comet/token generate.\n\nexport const tokenNames = ${JSON.stringify(tokenNames, null, 2)} as const;\n\nexport type TokenPath = keyof typeof tokenNames;\nexport type TokenName = (typeof tokenNames)[TokenPath];\n\nexport const tokens = Object.fromEntries(\n  Object.entries(tokenNames).map(([path, name]) => [path, \`var(\${name})\`]),\n) as { readonly [Path in TokenPath]: \`var(\${(typeof tokenNames)[Path]})\` };\n\nexport const themes = ${JSON.stringify(themes, null, 2)} as const;\n\nexport type Theme = keyof typeof themes;\n`;
  return { css, typescript, tokenNames, themes };
}

async function generate() {
  const packageRoot = new URL("../", import.meta.url);
  const source = JSON.parse(await readFile(new URL("figma/variables.json", packageRoot), "utf8"));
  const { css, typescript } = buildTokenArtifacts(source);
  const outputs = [
    ["styles.css", css],
    ["src/index.ts", typescript],
  ];
  const check = process.argv.includes("--check");
  for (const [path, content] of outputs) {
    const target = new URL(path, packageRoot);
    if (check) {
      const current = await readFile(target, "utf8").catch((error) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (current?.replaceAll("\r\n", "\n") !== content) {
        throw new Error(`Generated file is stale: ${fileURLToPath(target)}`);
      }
    } else {
      await mkdir(new URL(".", target), { recursive: true });
      await writeFile(target, content);
    }
  }
  process.stdout.write(
    `${check ? "Checked" : "Generated"} ${source.variables.length} Figma tokens.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate();
}
