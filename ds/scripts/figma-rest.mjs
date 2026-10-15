import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FILE_KEY = "aWNznF6uo5AlqF0YokiXZY";
export const PAGE_IDS = { ui: "39:41568", icons: "39:41567" };
const OUTPUT_PATH = "test-results/figma-sync";
const BASELINE_PATH = "ds/automation/figma-baseline.json";
const NODE_ID = /^\d+:\d+$/;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

export function stableStringify(value) {
  function normalize(item) {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(item[key])]),
      );
    }
    if (
      item === undefined ||
      ["function", "symbol", "bigint"].includes(typeof item) ||
      (typeof item === "number" && !Number.isFinite(item))
    ) {
      throw new Error("Figma data contains an unsupported value");
    }
    return item;
  }
  return JSON.stringify(normalize(value));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hashContext(context) {
  return createHash("sha256").update(stableStringify(context)).digest("hex");
}

export function validateSnapshot(snapshot) {
  if (
    !isRecord(snapshot) ||
    snapshot.schemaVersion !== 2 ||
    snapshot.fileKey !== FILE_KEY ||
    !Array.isArray(snapshot.entries) ||
    Object.keys(snapshot).some((key) => !["schemaVersion", "fileKey", "entries"].includes(key))
  ) {
    throw new Error("Invalid Figma REST baseline");
  }
  const ids = new Set();
  for (const entry of snapshot.entries) {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !NODE_ID.test(entry.id) ||
      typeof entry.kind !== "string" ||
      !Object.hasOwn(PAGE_IDS, entry.kind) ||
      typeof entry.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.hash) ||
      Object.keys(entry).some((key) => !["id", "kind", "hash", "context"].includes(key)) ||
      ids.has(entry.id)
    ) {
      throw new Error("Invalid or duplicate Figma REST baseline entry");
    }
    const context = entry.context;
    if (
      !isRecord(context) ||
      Object.keys(context).some(
        (key) => !["node", "components", "componentSets", "styles"].includes(key),
      ) ||
      ![context.node, context.components, context.componentSets, context.styles].every(isRecord) ||
      context.node.id !== entry.id ||
      typeof context.node.name !== "string" ||
      !["COMPONENT", "COMPONENT_SET"].includes(context.node.type) ||
      hashContext(context) !== entry.hash
    ) {
      throw new Error("Invalid Figma REST baseline context or hash");
    }
    ids.add(entry.id);
  }
  return snapshot;
}

function origin(node) {
  const box = node.absoluteBoundingBox;
  if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y)) {
    throw new Error("Figma component is missing absolute bounds");
  }
  return { x: box.x, y: box.y };
}

export function normalizeNode(node, anchor = origin(node), independent = true) {
  const output = structuredClone(node);
  for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"]) {
    if (output[key]) {
      output[key].x = Number((output[key].x - anchor.x).toFixed(6));
      output[key].y = Number((output[key].y - anchor.y).toFixed(6));
    }
  }
  if (independent) {
    if (output.relativeTransform) {
      output.relativeTransform[0][2] = 0;
      output.relativeTransform[1][2] = 0;
    }
    if (Object.hasOwn(output, "x")) output.x = 0;
    if (Object.hasOwn(output, "y")) output.y = 0;
  }
  if (node.children) {
    output.children = node.children.map((child) => {
      const variant = node.type === "COMPONENT_SET" && child.type === "COMPONENT";
      return normalizeNode(child, variant ? origin(child) : anchor, variant);
    });
  }
  return output;
}

function metadataFor(node, response) {
  const componentIds = new Set();
  const styleIds = new Set();
  function visit(current) {
    componentIds.add(current.id);
    if (current.componentId) componentIds.add(current.componentId);
    for (const id of Object.values(current.styles ?? {})) styleIds.add(id);
    for (const child of current.children ?? []) visit(child);
  }
  visit(node);
  const components = Object.fromEntries(
    [...componentIds]
      .filter((id) => response.components?.[id])
      .map((id) => [id, response.components[id]]),
  );
  const setIds = new Set([
    node.id,
    ...Object.values(components).map((item) => item.componentSetId),
  ]);
  return {
    components,
    componentSets: Object.fromEntries(
      [...setIds]
        .filter((id) => response.componentSets?.[id])
        .map((id) => [id, response.componentSets[id]]),
    ),
    styles: Object.fromEntries(
      [...styleIds].filter((id) => response.styles?.[id]).map((id) => [id, response.styles[id]]),
    ),
  };
}

export function createSnapshot(response, iconIds = []) {
  if (
    !response?.document ||
    response.document.type !== "DOCUMENT" ||
    response.err ||
    response.error
  ) {
    throw new Error("Figma returned an invalid file response");
  }
  const mappedIcons = new Set(iconIds);
  const entries = [];
  for (const [kind, pageId] of Object.entries(PAGE_IDS)) {
    const page = response.document.children?.find((item) => item?.id === pageId);
    if (!page || page.type !== "CANVAS" || !Array.isArray(page.children)) {
      throw new Error(`Figma response is missing the complete ${kind} page`);
    }
    function visit(node, parentType) {
      if (!node || typeof node.type !== "string" || typeof node.id !== "string") {
        throw new Error("Figma response contains an invalid node");
      }
      const root =
        node.type === "COMPONENT_SET" ||
        (node.type === "COMPONENT" && (parentType !== "COMPONENT_SET" || mappedIcons.has(node.id)));
      const selected = kind === "ui" || mappedIcons.has(node.id) || node.name?.startsWith("Icon/");
      if (root && selected) {
        const context = JSON.parse(
          stableStringify({ node: normalizeNode(node), ...metadataFor(node, response) }),
        );
        entries.push({
          id: node.id,
          kind,
          hash: hashContext(context),
          context,
        });
        return;
      }
      for (const child of node.children ?? []) visit(child, node.type);
    }
    for (const node of page.children) visit(node, page.type);
  }
  entries.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const snapshot = validateSnapshot({ schemaVersion: 2, fileKey: FILE_KEY, entries });
  return { snapshot };
}

export function diffSnapshots(baseline, current) {
  validateSnapshot(baseline);
  validateSnapshot(current);
  const before = new Map(baseline.entries.map((entry) => [entry.id, entry]));
  const after = new Map(current.entries.map((entry) => [entry.id, entry]));
  const describe = (entry) => ({
    ...entry,
    name: entry.context.node.name,
    url: `https://www.figma.com/design/${FILE_KEY}?node-id=${entry.id.replace(":", "-")}`,
  });
  return {
    added: current.entries.filter((entry) => !before.has(entry.id)).map(describe),
    changed: current.entries
      .filter((entry) => {
        const previous = before.get(entry.id);
        return previous && (previous.hash !== entry.hash || previous.kind !== entry.kind);
      })
      .map(describe),
    removed: baseline.entries.filter((entry) => !after.has(entry.id)).map(describe),
  };
}

async function requestFigma(path, token, fetchImpl) {
  if (typeof token !== "string" || !token.trim()) throw new Error("FIGMA_TOKEN is required");
  let response;
  try {
    response = await fetchImpl(`https://api.figma.com${path}`, {
      headers: { "X-Figma-Token": token },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Figma API request failed or timed out");
  }
  if (!response.ok) throw new Error(`Figma API request failed (HTTP ${response.status})`);
  if (!response.body || Number(response.headers?.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Figma API response is missing or exceeds the size limit");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Response size limit exceeded");
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    throw new Error("Figma API response failed, timed out, or exceeded the size limit");
  } finally {
    reader.releaseLock();
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Figma API returned invalid JSON");
  }
  if (!data || data.err || data.error || (Number.isInteger(data.status) && data.status >= 400)) {
    throw new Error("Figma API returned an error response");
  }
  return data;
}

export async function fetchFile({ token, fetchImpl = fetch }) {
  const params = new URLSearchParams({ ids: Object.values(PAGE_IDS).join(","), geometry: "paths" });
  return requestFigma(`/v1/files/${FILE_KEY}?${params}`, token, fetchImpl);
}

export async function prepare({ root = process.cwd(), env = process.env, fetchImpl = fetch } = {}) {
  let baseline;
  try {
    baseline = validateSnapshot(JSON.parse(await readFile(resolve(root, BASELINE_PATH), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const mapping = JSON.parse(await readFile(resolve(root, "ds/icon/figma/icons.json"), "utf8"));
  if (
    mapping.fileKey !== FILE_KEY ||
    !Array.isArray(mapping.icons) ||
    mapping.icons.some((icon) => typeof icon?.id !== "string" || !NODE_ID.test(icon.id))
  ) {
    throw new Error("Invalid Figma icon mapping");
  }
  const response = await fetchFile({ token: env.FIGMA_TOKEN, fetchImpl });
  const { snapshot } = createSnapshot(response, [
    ...mapping.icons.map((icon) => icon.id),
    ...(baseline?.entries.filter((entry) => entry.kind === "icons").map((entry) => entry.id) ?? []),
  ]);
  const baselineInitialization = !baseline;
  const diff = baselineInitialization
    ? { added: [], changed: [], removed: [] }
    : diffSnapshots(baseline, snapshot);
  const changed =
    baselineInitialization || Object.values(diff).some((entries) => entries.length > 0);
  const output = resolve(root, OUTPUT_PATH);
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "next-baseline.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  if (env.GITHUB_OUTPUT) {
    await appendFile(
      env.GITHUB_OUTPUT,
      `changed=${changed}\nbaseline_initialization=${baselineInitialization}\n`,
    );
  }
  return { changed, baselineInitialization, snapshot, diff };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "prepare" || process.argv.length !== 3) {
    console.error("Usage: node ds/scripts/figma-rest.mjs prepare");
    process.exitCode = 1;
  } else {
    try {
      const result = await prepare();
      console.log(
        JSON.stringify({
          changed: result.changed,
          baselineInitialization: result.baselineInitialization,
        }),
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
