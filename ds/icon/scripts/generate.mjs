import { readFile, readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/generate.mjs [--check]");
}

const source = JSON.parse(await readFile(path.join(packageRoot, "figma/icons.json"), "utf8"));
const attributeNames = {
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-opacity": "strokeOpacity",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "clip-rule": "clipRule",
};
const shapeAttributes = {
  path: ["d"],
  circle: ["cx", "cy", "r"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
};
const paintAttributes = new Set([
  "fill",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "fill-opacity",
  "opacity",
  "fill-rule",
  "clip-rule",
]);
const componentNames = {
  arrowright: "ArrowRightIcon",
  chevdown: "ChevDownIcon",
  chevleft: "ChevLeftIcon",
  cupdown: "CupDownIcon",
};

function attributes(text, allowed, context) {
  const parsed = [];
  const seen = new Set();
  const expression = /\s+([A-Za-z][\w:-]*)="([^"<>&]*)"/y;
  let offset = 0;
  while (offset < text.length && text.slice(offset).trim()) {
    expression.lastIndex = offset;
    const match = expression.exec(text);
    if (!match || !allowed.has(match[1]) || seen.has(match[1])) {
      throw new Error(`Unsupported or duplicate attribute in ${context}: ${text.slice(offset)}`);
    }
    const [, name, value] = match;
    if ((name === "fill" || name === "stroke") && value !== "none" && value !== "#EEF1FF") {
      throw new Error(`Unsupported paint in ${context}: ${value}`);
    }
    parsed.push([name, value]);
    seen.add(name);
    offset = expression.lastIndex;
  }
  return parsed;
}

function jsxAttributes(entries) {
  return entries
    .map(([name, value]) => {
      const normalized = value === "#EEF1FF" ? "currentColor" : value;
      return `${attributeNames[name] ?? name}={${JSON.stringify(normalized)}}`;
    })
    .join(" ");
}

function parseIcon(icon) {
  if (icon.width !== 20 || icon.height !== 20 || typeof icon.svg !== "string") {
    throw new Error(`Expected a 20x20 SVG: ${icon.name}`);
  }
  const match = /^\s*<svg([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(icon.svg);
  if (!match) throw new Error(`Unsupported SVG structure: ${icon.name}`);
  const root = attributes(
    match[1],
    new Set(["width", "height", "viewBox", "fill", "xmlns"]),
    icon.name,
  );
  const properties = Object.fromEntries(root);
  if (
    properties.width !== "20" ||
    properties.height !== "20" ||
    properties.viewBox !== "0 0 20 20" ||
    properties.fill !== "none" ||
    properties.xmlns !== "http://www.w3.org/2000/svg"
  ) {
    throw new Error(`Unexpected root SVG properties: ${icon.name}`);
  }

  const shapes = [];
  const expression = /\s*<(path|circle|rect)([^>]*)\/>/y;
  let offset = 0;
  while (offset < match[2].length && match[2].slice(offset).trim()) {
    expression.lastIndex = offset;
    const shape = expression.exec(match[2]);
    if (!shape) throw new Error(`Unsupported SVG child: ${icon.name}`);
    const [, tag, content] = shape;
    const values = attributes(
      content,
      new Set([...shapeAttributes[tag], ...paintAttributes]),
      icon.name,
    );
    if (tag === "path" && !values.some(([name, value]) => name === "d" && value)) {
      throw new Error(`Path is missing its geometry: ${icon.name}`);
    }
    shapes.push(`<${tag} ${jsxAttributes(values)} />`);
    offset = expression.lastIndex;
  }
  if (!shapes.length) throw new Error(`Empty SVG: ${icon.name}`);
  return { root: root.filter(([name]) => name !== "width" && name !== "height"), shapes };
}

if (!Array.isArray(source.icons) || source.icons.length === 0)
  throw new Error("Empty icon catalogue");
const generated = new Map();
const names = new Set();
const exports = new Set();
const catalogue = source.icons.map((icon) => {
  const name = /^Icon\/([a-z][a-z0-9]*)$/.exec(icon.name)?.[1];
  if (!name || names.has(name)) throw new Error(`Invalid icon name: ${icon.name}`);
  const component = componentNames[name] ?? `${name[0].toUpperCase()}${name.slice(1)}Icon`;
  if (exports.has(component)) throw new Error(`Duplicate icon component: ${component}`);
  names.add(name);
  exports.add(component);
  const { root, shapes } = parseIcon(icon);
  const sourceProperties = JSON.stringify(Object.fromEntries(root));
  generated.set(
    `src/icons/${component}.tsx`,
    `// Generated from figma/icons.json. Run pnpm --filter @comet/icon generate.\nimport { createIcon } from "../createIcon";\n\nexport const ${component} = createIcon(\n  "${component}",\n  ${sourceProperties},\n  <>\n${shapes.map((shape) => `    ${shape}`).join("\n")}\n  </>,\n);\n`,
  );
  return { name, component };
});

const imports = catalogue
  .map(({ component }) => `import { ${component} } from "./icons/${component}";`)
  .join("\n");
const entries = catalogue.map(({ name, component }) => `  ${name}: ${component},`).join("\n");
generated.set(
  "src/Icon.tsx",
  `// Generated from figma/icons.json. Run pnpm --filter @comet/icon generate.\nimport { forwardRef } from "react";\nimport type { IconProps } from "./createIcon";\n${imports}\n\nconst icons = {\n${entries}\n} as const;\n\nexport type IconName = keyof typeof icons;\nexport const iconNames = Object.freeze(Object.keys(icons) as IconName[]);\n\nexport const Icon = forwardRef<SVGSVGElement, IconProps & { name: IconName }>((\n  { name, ...props },\n  ref,\n) => {\n  const Component = icons[name];\n  return <Component {...props} ref={ref} />;\n});\nIcon.displayName = "Icon";\n`,
);
generated.set(
  "src/index.ts",
  `// Generated from figma/icons.json. Run pnpm --filter @comet/icon generate.\nexport { Icon, iconNames, type IconName } from "./Icon";\nexport type { IconProps } from "./createIcon";\n${catalogue.map(({ component }) => `export { ${component} } from "./icons/${component}";`).join("\n")}\n`,
);

let stale = false;
for (const [relative, expected] of generated) {
  const file = path.join(packageRoot, relative);
  const actual = await readFile(file, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (actual === expected) continue;
  if (check) {
    process.stderr.write(`Generated icon file is stale or missing: ${relative}\n`);
    stale = true;
  } else {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, expected);
  }
}
for (const file of await readdir(path.join(packageRoot, "src/icons")).catch(() => [])) {
  if (!file.endsWith(".tsx") || generated.has(`src/icons/${file}`)) continue;
  if (check) {
    process.stderr.write(`Obsolete generated icon file: src/icons/${file}\n`);
    stale = true;
  } else {
    await unlink(path.join(packageRoot, "src/icons", file));
  }
}
if (stale) process.exitCode = 1;
else process.stdout.write(`${check ? "Checked" : "Generated"} ${catalogue.length} Figma icons.\n`);
