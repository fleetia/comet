import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_KEY,
  PAGE_IDS,
  createSnapshot,
  diffSnapshots,
  fetchFile,
  prepare,
  validateSnapshot,
} from "./figma-rest.mjs";

function box(x, y, width = 100, height = 40) {
  return { x, y, width, height };
}

function component(id, name, x, y) {
  return {
    id,
    name,
    type: "COMPONENT",
    absoluteBoundingBox: box(x, y),
    absoluteRenderBounds: box(x - 2, y - 2, 104, 44),
    relativeTransform: [
      [1, 0, x],
      [0, 1, y],
    ],
    children: [
      {
        id: `${id.split(":")[0]}:99`,
        type: "VECTOR",
        name: "Hidden detail",
        visible: false,
        absoluteBoundingBox: box(x + 10, y + 10, 20, 20),
        relativeTransform: [
          [1, 0, 10],
          [0, 1, 10],
        ],
        fillGeometry: [{ windingRule: "NONZERO", path: "M0 0L20 20" }],
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "VariableID:1:9" }] },
        styles: { fill: "S:1" },
      },
    ],
  };
}

function file() {
  return {
    version: "version-1",
    lastModified: "2026-10-15T00:00:00Z",
    document: {
      id: "0:0",
      type: "DOCUMENT",
      children: [
        {
          id: PAGE_IDS.ui,
          type: "CANVAS",
          children: [
            {
              id: "1:1",
              type: "COMPONENT_SET",
              name: "Button",
              absoluteBoundingBox: box(100, 200, 300, 100),
              relativeTransform: [
                [1, 0, 100],
                [0, 1, 200],
              ],
              componentPropertyDefinitions: { size: { type: "VARIANT", defaultValue: "Small" } },
              children: [
                component("2:1", "size=Small", 120, 220),
                component("3:1", "size=Large", 240, 220),
              ],
            },
          ],
        },
        {
          id: PAGE_IDS.icons,
          type: "CANVAS",
          children: [component("4:1", "Icon/arrow", 400, 100)],
        },
      ],
    },
    components: { "2:1": { name: "size=Small", componentSetId: "1:1" } },
    componentSets: { "1:1": { name: "Button", description: "Primary button" } },
    styles: { "S:1": { name: "Content/primary", styleType: "FILL" } },
  };
}

function move(node, dx, dy) {
  for (const key of ["absoluteBoundingBox", "absoluteRenderBounds"]) {
    if (node[key]) {
      node[key].x += dx;
      node[key].y += dy;
    }
  }
  for (const child of node.children ?? []) move(child, dx, dy);
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
}

const temporaryRoots = [];
async function setupRoot() {
  const root = await mkdtemp(join(tmpdir(), "figma-rest-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "ds/icon/figma"), { recursive: true });
  await writeFile(
    join(root, "ds/icon/figma/icons.json"),
    JSON.stringify({ fileKey: FILE_KEY, icons: [{ id: "4:1" }] }),
  );
  return root;
}

async function saveBaseline(root, snapshot) {
  await mkdir(join(root, "ds/automation"), { recursive: true });
  await writeFile(join(root, "ds/automation/figma-baseline.json"), JSON.stringify(snapshot));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Figma REST snapshots", () => {
  it("ignores canvas and variant grid movement while preserving internal geometry", () => {
    const original = file();
    const current = structuredClone(original);
    const set = current.document.children[0].children[0];
    move(set, 1000, 2000);
    set.relativeTransform[0][2] += 1000;
    set.relativeTransform[1][2] += 2000;
    move(set.children[1], 25, 45);
    set.children[1].relativeTransform[0][2] += 25;
    set.children[1].relativeTransform[1][2] += 45;
    expect(createSnapshot(current).snapshot).toEqual(createSnapshot(original).snapshot);
    set.children[0].children[0].relativeTransform[0][2] += 2;
    expect(
      diffSnapshots(
        createSnapshot(original).snapshot,
        createSnapshot(current).snapshot,
      ).changed.map(({ id }) => id),
    ).toEqual(["1:1"]);
  });

  it.each(["geometry", "hidden-fill", "binding", "dimensions", "metadata"])(
    "retains the context needed to report %s changes",
    (change) => {
      const original = file();
      const current = structuredClone(original);
      const set = current.document.children[0].children[0];
      const detail = set.children[0].children[0];
      if (change === "geometry") detail.fillGeometry[0].path = "M0 0L25 25";
      if (change === "hidden-fill") detail.fills[0].color.r = 0.5;
      if (change === "binding") detail.boundVariables.fills[0].id = "VariableID:2:9";
      if (change === "dimensions") set.children[0].absoluteBoundingBox.width += 1;
      if (change === "metadata") current.componentSets["1:1"].description = "Changed description";
      const baseline = createSnapshot(original).snapshot;
      const snapshot = createSnapshot(current).snapshot;
      const diff = diffSnapshots(baseline, snapshot);
      expect(diff.changed.map(({ id }) => id)).toEqual(["1:1"]);
      expect(diff.changed[0].name).toBe("Button");
      expect(diff.changed[0].context).toEqual(snapshot.entries[0].context);
      expect(diff.changed[0].context).not.toEqual(baseline.entries[0].context);
    },
  );

  it("detects additions and removals and retains renamed mapped icons", () => {
    const original = file();
    const current = structuredClone(original);
    current.document.children[0].children = [];
    current.document.children[1].children[0].name = "Renamed icon";
    current.document.children[1].children.push(component("5:1", "Icon/new", 0, 0));
    const diff = diffSnapshots(
      createSnapshot(original).snapshot,
      createSnapshot(current, ["4:1"]).snapshot,
    );
    expect(diff.added.map(({ id }) => id)).toEqual(["5:1"]);
    expect(diff.changed.map(({ id }) => id)).toEqual(["4:1"]);
    expect(diff.removed.map(({ id }) => id)).toEqual(["1:1"]);
    expect(diff.removed[0]).toMatchObject({
      name: "Button",
      url: `https://www.figma.com/design/${FILE_KEY}?node-id=1-1`,
    });
  });

  it("stabilizes root and object key order without discarding internal stacking changes", () => {
    const original = file();
    original.document.children[0].children.push(component("5:1", "Badge", 500, 0));
    const current = structuredClone(original);
    current.document.children.reverse();
    current.document.children[1].children.reverse();
    current.components["2:1"] = { componentSetId: "1:1", name: "size=Small" };
    current.version = "new-file-version";
    current.lastModified = "2026-10-16T00:00:00Z";
    expect(JSON.stringify(createSnapshot(current).snapshot)).toBe(
      JSON.stringify(createSnapshot(original).snapshot),
    );
    current.document.children[1].children[1].children[0].children.push(
      component("6:1", "Overlay", 150, 220),
    );
    const beforeReorder = createSnapshot(current).snapshot;
    current.document.children[1].children[1].children[0].children.reverse();
    expect(diffSnapshots(beforeReorder, createSnapshot(current).snapshot).changed).toHaveLength(1);
  });

  it("rejects incomplete pages, duplicate roots, v1 baselines, and mismatched context hashes", () => {
    const current = file();
    current.document.children[1] = null;
    expect(() => createSnapshot(current)).toThrow("complete icons page");
    const baseline = createSnapshot(file()).snapshot;
    expect(() => validateSnapshot({ ...baseline, schemaVersion: 1 })).toThrow("Invalid");
    expect(() => validateSnapshot({ ...baseline, fileKey: "other" })).toThrow("Invalid");
    expect(() =>
      validateSnapshot({ ...baseline, entries: [...baseline.entries, baseline.entries[0]] }),
    ).toThrow("duplicate");
    const corrupt = structuredClone(baseline);
    corrupt.entries[0].context.node.name = "Tampered";
    expect(() => validateSnapshot(corrupt)).toThrow("context or hash");
    delete corrupt.entries[0].context;
    expect(() => validateSnapshot(corrupt)).toThrow("context or hash");
  });
});

describe("Figma requests and preparation", () => {
  it("requests complete page trees with paths and safely reports authentication failures", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("secret-token", { status: 403 }));
    await expect(fetchFile({ token: "secret-token", fetchImpl })).rejects.toThrow("HTTP 403");
    const [url, options] = fetchImpl.mock.calls[0];
    expect(new URL(url).searchParams.get("geometry")).toBe("paths");
    expect(new URL(url).searchParams.get("ids")).toBe(Object.values(PAGE_IDS).join(","));
    expect(new URL(url).searchParams.has("depth")).toBe(false);
    expect(options.headers["X-Figma-Token"]).toBe("secret-token");
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails on missing credentials, network errors, invalid JSON, or API error envelopes", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchFile({ token: "", fetchImpl })).rejects.toThrow("FIGMA_TOKEN");
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockRejectedValueOnce(new Error("secret-token"));
    await expect(fetchFile({ token: "token", fetchImpl })).rejects.toThrow("failed or timed out");
    fetchImpl.mockResolvedValueOnce(new Response("not-json"));
    await expect(fetchFile({ token: "token", fetchImpl })).rejects.toThrow("invalid JSON");
    fetchImpl.mockResolvedValueOnce(jsonResponse({ err: "secret-token" }));
    await expect(fetchFile({ token: "token", fetchImpl })).rejects.toThrow("error response");
  });

  it.each([true, false])(
    "bounds response size with Content-Length present=%s",
    async (hasLength) => {
      let chunks = 0;
      const response = new Response(
        new ReadableStream({
          pull(controller) {
            chunks += 1;
            if (chunks > 51) controller.close();
            else controller.enqueue(new Uint8Array(1024 * 1024));
          },
        }),
        { headers: hasLength ? { "content-length": String(51 * 1024 * 1024) } : {} },
      );
      const fetchImpl = vi.fn().mockResolvedValue(response);
      await expect(fetchFile({ token: "token", fetchImpl })).rejects.toThrow("size limit");
    },
  );

  it("automatically prepares an initial snapshot without changing the committed baseline", async () => {
    const root = await setupRoot();
    const output = join(root, "github-output");
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(file()));
    const result = await prepare({
      root,
      env: { FIGMA_TOKEN: "token", GITHUB_OUTPUT: output },
      fetchImpl,
    });
    expect(result.changed).toBe(true);
    expect(result.baselineInitialization).toBe(true);
    expect(result.diff).toEqual({ added: [], changed: [], removed: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(output, "utf8")).toBe("changed=true\nbaseline_initialization=true\n");
    await expect(readFile(join(root, "ds/automation/figma-baseline.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      validateSnapshot(
        JSON.parse(
          await readFile(join(root, "test-results/figma-sync/next-baseline.json"), "utf8"),
        ),
      ),
    ).toEqual(result.snapshot);
  });

  it("captures changed and removed component context without mutating the committed baseline", async () => {
    const root = await setupRoot();
    const original = file();
    const baseline = createSnapshot(original).snapshot;
    await saveBaseline(root, baseline);
    const current = structuredClone(original);
    current.document.children[0].children[0].children[0].children[0].fillGeometry[0].path =
      "M0 0L25 25";
    current.document.children[1].children = [];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(current));
    const result = await prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl });
    expect(result.changed).toBe(true);
    expect(result.baselineInitialization).toBe(false);
    expect(result.diff.changed.map(({ id }) => id)).toEqual(["1:1"]);
    expect(result.diff.removed.map(({ id }) => id)).toEqual(["4:1"]);
    expect(
      result.snapshot.entries[0].context.node.children[0].children[0].fillGeometry[0].path,
    ).toBe("M0 0L25 25");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(join(root, "ds/automation/figma-baseline.json"), "utf8")),
    ).toEqual(baseline);
  });

  it("reports unchanged state and keeps tracking a renamed previously discovered icon", async () => {
    const root = await setupRoot();
    const current = file();
    current.document.children[1].children.push(component("5:1", "Icon/new", 500, 200));
    await saveBaseline(root, createSnapshot(current).snapshot);
    const output = join(root, "github-output");
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(current));
    const result = await prepare({
      root,
      env: { FIGMA_TOKEN: "token", GITHUB_OUTPUT: output },
      fetchImpl,
    });
    expect(result.changed).toBe(false);
    expect(await readFile(output, "utf8")).toBe("changed=false\nbaseline_initialization=false\n");
    current.document.children[1].children[1].name = "Renamed icon";
    fetchImpl.mockResolvedValueOnce(jsonResponse(current));
    const renamed = await prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl });
    expect(renamed.diff.changed.map(({ id }) => id)).toEqual(["5:1"]);
    expect(renamed.diff.removed).toEqual([]);
  });

  it("refuses a corrupt existing baseline before network access", async () => {
    const root = await setupRoot();
    const snapshot = createSnapshot(file()).snapshot;
    snapshot.entries[0].hash = "0".repeat(64);
    await saveBaseline(root, snapshot);
    const fetchImpl = vi.fn();
    await expect(prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl })).rejects.toThrow(
      "context or hash",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
