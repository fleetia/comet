import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const FILE_KEY = "aWNznF6uo5AlqF0YokiXZY";
export const PAGE_IDS = { ui: "39:41568", icons: "39:41567" };
const OUTPUT_PATH = "test-results/figma-sync";
const BASELINE_PATH = "ds/automation/figma-baseline.json";
const NODE_ID = /^\d+:\d+$/;
const COVERAGE = {
  components: "resolved-values-and-bindings",
  variables: "not-fetched-professional-plan",
};

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

export function validateSnapshot(snapshot) {
  if (
    !snapshot ||
    snapshot.schemaVersion !== 1 ||
    snapshot.fileKey !== FILE_KEY ||
    !Array.isArray(snapshot.entries) ||
    Object.keys(snapshot).some((key) => !["schemaVersion", "fileKey", "entries"].includes(key))
  )
    throw new Error("Invalid Figma REST baseline");
  const ids = new Set();
  for (const entry of snapshot.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !NODE_ID.test(entry.id) ||
      typeof entry.kind !== "string" ||
      !Object.hasOwn(PAGE_IDS, entry.kind) ||
      typeof entry.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.hash) ||
      Object.keys(entry).some((key) => !["id", "kind", "hash"].includes(key)) ||
      ids.has(entry.id)
    )
      throw new Error("Invalid or duplicate Figma REST baseline entry");
    ids.add(entry.id);
  }
  return snapshot;
}

export function validateChanges(changes) {
  const keys = [
    "schemaVersion",
    "fileKey",
    "baselineOnly",
    "baselineInitialization",
    "sourceVersion",
    "sourceLastModified",
    "coverage",
    "added",
    "changed",
    "removed",
    "nodes",
    "imageUrls",
    "imageFiles",
    "renderFailures",
  ];
  if (
    !changes ||
    changes.schemaVersion !== 1 ||
    changes.fileKey !== FILE_KEY ||
    typeof changes.baselineOnly !== "boolean" ||
    changes.baselineInitialization !== changes.baselineOnly ||
    ![changes.sourceVersion, changes.sourceLastModified].every(
      (value) => value === null || typeof value === "string",
    ) ||
    stableStringify(changes.coverage) !== stableStringify(COVERAGE) ||
    Object.keys(changes).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(changes, key))
  )
    throw new Error("Invalid Figma REST change manifest");
  const allEntries = [];
  for (const key of ["added", "changed", "removed"]) {
    if (!Array.isArray(changes[key])) throw new Error("Invalid Figma REST change entries");
    for (const entry of changes[key]) {
      if (
        !entry ||
        Object.keys(entry).some((field) => !["id", "kind", "hash", "url"].includes(field)) ||
        typeof entry.id !== "string" ||
        entry.url !==
          `https://www.figma.com/design/${FILE_KEY}?node-id=${entry.id.replace(":", "-")}`
      ) {
        throw new Error("Invalid Figma REST change entry link");
      }
      allEntries.push({ id: entry.id, kind: entry.kind, hash: entry.hash });
    }
  }
  validateSnapshot({ schemaVersion: 1, fileKey: FILE_KEY, entries: allEntries });
  const expectedNodes = [...changes.added, ...changes.changed].map(({ id, kind }) => ({
    id,
    kind,
    path: `${OUTPUT_PATH}/nodes/${id.replace(":", "-")}.json`,
  }));
  if (
    stableStringify(changes.nodes) !== stableStringify(expectedNodes) ||
    !Array.isArray(changes.imageUrls) ||
    !Array.isArray(changes.imageFiles) ||
    !Array.isArray(changes.renderFailures) ||
    (changes.baselineOnly && allEntries.length > 0)
  ) {
    throw new Error("Invalid Figma REST node context manifest");
  }
  const expectedIds = new Set(expectedNodes.map(({ id }) => id));
  const urlIds = new Set();
  for (const entry of changes.imageUrls) {
    if (
      !entry ||
      !expectedIds.has(entry.id) ||
      urlIds.has(entry.id) ||
      Object.keys(entry).some((key) => !["id", "url"].includes(key)) ||
      !allowedImageUrl(entry.url)
    ) {
      throw new Error("Invalid Figma render URL manifest");
    }
    urlIds.add(entry.id);
  }
  const renderedIds = new Set();
  for (const entry of changes.imageFiles) {
    if (
      !entry ||
      !urlIds.has(entry.id) ||
      renderedIds.has(entry.id) ||
      Object.keys(entry).some((key) => !["id", "path"].includes(key)) ||
      entry.path !== `${OUTPUT_PATH}/images/${entry.id.replace(":", "-")}.png`
    ) {
      throw new Error("Invalid Figma render file manifest");
    }
    renderedIds.add(entry.id);
  }
  for (const entry of changes.renderFailures) {
    if (
      !entry ||
      !expectedIds.has(entry.id) ||
      renderedIds.has(entry.id) ||
      Object.keys(entry).some((key) => !["id", "reason"].includes(key)) ||
      typeof entry.reason !== "string" ||
      !entry.reason
    ) {
      throw new Error("Invalid Figma render failure manifest");
    }
    renderedIds.add(entry.id);
  }
  if (renderedIds.size !== expectedIds.size) throw new Error("Incomplete Figma render manifest");
  return changes;
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
  const nodes = new Map();
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
        const context = { node: normalizeNode(node), ...metadataFor(node, response) };
        entries.push({
          id: node.id,
          kind,
          hash: createHash("sha256").update(stableStringify(context)).digest("hex"),
        });
        nodes.set(node.id, context);
        return;
      }
      for (const child of node.children ?? []) visit(child, node.type);
    }
    for (const node of page.children) visit(node, page.type);
  }
  entries.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const snapshot = validateSnapshot({ schemaVersion: 1, fileKey: FILE_KEY, entries });
  return { snapshot, nodes };
}

export function diffSnapshots(baseline, current) {
  validateSnapshot(baseline);
  validateSnapshot(current);
  const before = new Map(baseline.entries.map((entry) => [entry.id, entry]));
  const after = new Map(current.entries.map((entry) => [entry.id, entry]));
  const describe = (entry) => ({
    ...entry,
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
  let data;
  try {
    data = await response.json();
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

export async function fetchImageUrls({ ids, version, token, fetchImpl = fetch }) {
  const imageUrls = [];
  const renderFailures = [];
  if (typeof version !== "string" || !version) {
    return {
      imageUrls,
      renderFailures: ids.map((id) => ({
        id,
        reason: "Figma response has no version to pin renders",
      })),
    };
  }
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const params = new URLSearchParams({
      ids: batch.join(","),
      format: "png",
      scale: "1",
      version,
    });
    try {
      const data = await requestFigma(`/v1/images/${FILE_KEY}?${params}`, token, fetchImpl);
      for (const id of batch) {
        const url = data.images?.[id];
        if (allowedImageUrl(url)) {
          imageUrls.push({ id, url });
        } else renderFailures.push({ id, reason: "Figma returned no allowed HTTPS render URL" });
      }
    } catch (error) {
      for (const id of batch) renderFailures.push({ id, reason: error.message });
    }
  }
  return { imageUrls, renderFailures };
}

function allowedImageUrl(value) {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    (url.hostname === "figma.com" ||
      url.hostname.endsWith(".figma.com") ||
      /^figma-alpha-api\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(url.hostname))
  );
}

export async function downloadImages({ imageUrls, root, fetchImpl = fetch }) {
  const imageFiles = [];
  const renderFailures = [];
  const perFileLimit = 20 * 1024 * 1024;
  const totalLimit = 100 * 1024 * 1024;
  let totalBytes = 0;
  const directory = resolve(root, OUTPUT_PATH, "images");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  for (const { id, url } of imageUrls) {
    if (typeof id !== "string" || !NODE_ID.test(id) || !allowedImageUrl(url)) {
      throw new Error("Invalid Figma image download target");
    }
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]);
    try {
      const response = await fetchImpl(url, { redirect: "error", signal });
      if (!response.ok || !response.body) throw new Error("Render download failed");
      const declaredBytes = Number(response.headers?.get("content-length"));
      if (declaredBytes > perFileLimit || declaredBytes + totalBytes > totalLimit) {
        throw new Error("Render download exceeds size limit");
      }
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        totalBytes += value.byteLength;
        if (bytes > perFileLimit || totalBytes > totalLimit) {
          await reader.cancel();
          throw new Error("Render download exceeds size limit");
        }
        chunks.push(Buffer.from(value));
      }
      const image = Buffer.concat(chunks);
      if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error("Render download is not PNG");
      }
      const path = `${OUTPUT_PATH}/images/${id.replace(":", "-")}.png`;
      await writeFile(resolve(root, path), image);
      imageFiles.push({ id, path });
    } catch {
      renderFailures.push({
        id,
        reason: "PNG download failed, exceeded its size limit, or returned invalid data",
      });
    } finally {
      abort.abort();
    }
  }
  return { imageFiles, renderFailures };
}

export async function prepare({ root = process.cwd(), env = process.env, fetchImpl = fetch } = {}) {
  if (![undefined, "true", "false"].includes(env.FIGMA_BASELINE_ONLY)) {
    throw new Error("FIGMA_BASELINE_ONLY must be true or false");
  }
  const baselineOnly = env.FIGMA_BASELINE_ONLY === "true";
  let baseline;
  try {
    baseline = validateSnapshot(JSON.parse(await readFile(resolve(root, BASELINE_PATH), "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (!baselineOnly) {
      throw new Error(
        "Figma baseline is missing; run a manual baseline-only workflow and merge its PR first",
      );
    }
  }
  if (baselineOnly && baseline)
    throw new Error("A Figma baseline already exists; baseline-only cannot overwrite it");
  const mapping = JSON.parse(await readFile(resolve(root, "ds/icon/figma/icons.json"), "utf8"));
  if (mapping.fileKey !== FILE_KEY || !Array.isArray(mapping.icons))
    throw new Error("Invalid Figma icon mapping");
  const response = await fetchFile({ token: env.FIGMA_TOKEN, fetchImpl });
  const { snapshot, nodes } = createSnapshot(
    response,
    mapping.icons.map((icon) => icon.id),
  );
  const diff = baselineOnly
    ? { added: [], changed: [], removed: [] }
    : diffSnapshots(baseline, snapshot);
  const changedEntries = [...diff.added, ...diff.changed];
  const changed = baselineOnly || changedEntries.length > 0 || diff.removed.length > 0;
  const renders = baselineOnly
    ? { imageUrls: [], renderFailures: [] }
    : await fetchImageUrls({
        ids: changedEntries.map(({ id }) => id),
        version: response.version,
        token: env.FIGMA_TOKEN,
        fetchImpl,
      });
  const downloads = await downloadImages({ imageUrls: renders.imageUrls, root, fetchImpl });
  const changes = {
    schemaVersion: 1,
    fileKey: FILE_KEY,
    baselineOnly,
    baselineInitialization: baselineOnly,
    sourceVersion: response.version ?? null,
    sourceLastModified: response.lastModified ?? null,
    coverage: COVERAGE,
    ...diff,
    nodes: changedEntries.map(({ id, kind }) => ({
      id,
      kind,
      path: `${OUTPUT_PATH}/nodes/${id.replace(":", "-")}.json`,
    })),
    imageUrls: renders.imageUrls,
    imageFiles: downloads.imageFiles,
    renderFailures: [...renders.renderFailures, ...downloads.renderFailures],
  };
  validateChanges(changes);
  const output = resolve(root, OUTPUT_PATH);
  await mkdir(output, { recursive: true });
  await rm(resolve(output, "nodes"), { recursive: true, force: true });
  await mkdir(resolve(output, "nodes"));
  for (const entry of changes.nodes) {
    await writeFile(
      resolve(root, entry.path),
      `${JSON.stringify({ fileKey: FILE_KEY, sourceVersion: changes.sourceVersion, ...nodes.get(entry.id) }, null, 2)}\n`,
    );
  }
  await writeFile(resolve(output, "next-baseline.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  await writeFile(resolve(output, "changes.json"), `${JSON.stringify(changes, null, 2)}\n`);
  if (env.GITHUB_OUTPUT) {
    await appendFile(env.GITHUB_OUTPUT, `changed=${changed}\nbaseline_only=${baselineOnly}\n`);
  }
  return { changed, baselineOnly, changes, snapshot };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] !== "prepare" || process.argv.length !== 3) {
    console.error("Usage: node ds/scripts/figma-rest.mjs prepare");
    process.exitCode = 1;
  } else {
    try {
      const result = await prepare();
      console.log(JSON.stringify({ changed: result.changed, baselineOnly: result.baselineOnly }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
