import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FILE_KEY,
  PAGE_IDS,
  createSnapshot,
  diffSnapshots,
  downloadImages,
  fetchFile,
  fetchImageUrls,
  prepare,
  validateChanges,
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

function pngResponse(bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])) {
  return {
    ok: true,
    headers: { get: () => String(bytes.byteLength) },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
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
    "detects %s changes",
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
      expect(
        diffSnapshots(
          createSnapshot(original).snapshot,
          createSnapshot(current).snapshot,
        ).changed.map(({ id }) => id),
      ).toEqual(["1:1"]);
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
    expect(diff.removed[0].url).toContain("node-id=1-1");
  });

  it("rejects missing pages, invalid baselines, and duplicate roots", () => {
    const current = file();
    current.document.children[1] = null;
    expect(() => createSnapshot(current)).toThrow("complete icons page");
    const baseline = createSnapshot(file()).snapshot;
    expect(() => validateSnapshot({ ...baseline, fileKey: "other" })).toThrow("Invalid");
    expect(() =>
      validateSnapshot({ ...baseline, entries: [...baseline.entries, baseline.entries[0]] }),
    ).toThrow("duplicate");
    expect(() =>
      validateSnapshot({ ...baseline, entries: [{ ...baseline.entries[0], hash: "invalid" }] }),
    ).toThrow("Invalid");
  });
});

describe("Figma requests and preparation", () => {
  it("requests full page trees with paths and safely reports authentication failures", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, json: () => ({ err: "secret-token" }) });
    await expect(fetchFile({ token: "secret-token", fetchImpl })).rejects.toThrow("HTTP 403");
    const [url, options] = fetchImpl.mock.calls[0];
    expect(new URL(url).searchParams.get("geometry")).toBe("paths");
    expect(new URL(url).searchParams.get("ids")).toBe(Object.values(PAGE_IDS).join(","));
    expect(new URL(url).searchParams.has("depth")).toBe(false);
    expect(options.headers["X-Figma-Token"]).toBe("secret-token");
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("records null renders and pins all image requests to the snapshot version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ images: { "1:1": "https://s3-alpha.figma.com/example.png", "4:1": null } }),
    });
    const renders = await fetchImageUrls({
      ids: ["1:1", "4:1"],
      version: "exact-version",
      token: "token",
      fetchImpl,
    });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("version")).toBe("exact-version");
    expect(renders.imageUrls).toHaveLength(1);
    expect(renders.renderFailures).toEqual([
      { id: "4:1", reason: "Figma returned no allowed HTTPS render URL" },
    ]);
  });

  it("downloads PNGs without credentials and rejects redirects, untrusted hosts, and invalid bytes", async () => {
    const root = await setupRoot();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(pngResponse())
      .mockResolvedValueOnce(pngResponse(Buffer.from("not an image")));
    const result = await downloadImages({
      root,
      imageUrls: [
        { id: "1:1", url: "https://s3-alpha.figma.com/image.png" },
        { id: "2:1", url: "https://figma-alpha-api.s3.us-west-2.amazonaws.com/image.png" },
      ],
      fetchImpl,
    });
    expect(result.imageFiles).toEqual([
      { id: "1:1", path: "test-results/figma-sync/images/1-1.png" },
    ]);
    expect(result.renderFailures.map(({ id }) => id)).toEqual(["2:1"]);
    expect(fetchImpl.mock.calls[0][1].headers).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].redirect).toBe("error");
    await expect(
      downloadImages({
        root,
        imageUrls: [{ id: "1:1", url: "https://example.com/image.png" }],
        fetchImpl,
      }),
    ).rejects.toThrow("Invalid");
    await expect(
      downloadImages({
        root,
        imageUrls: [{ id: "../escape", url: "https://figma.com/image.png" }],
        fetchImpl,
      }),
    ).rejects.toThrow("Invalid");
  });

  it("rejects oversized renders even when Content-Length is absent", async () => {
    const root = await setupRoot();
    const fetchImpl = vi.fn().mockResolvedValue({
      ...pngResponse(Buffer.alloc(20 * 1024 * 1024 + 1)),
      headers: { get: () => null },
    });
    const result = await downloadImages({
      root,
      imageUrls: [{ id: "1:1", url: "https://figma.com/image.png" }],
      fetchImpl,
    });
    expect(result.imageFiles).toEqual([]);
    expect(result.renderFailures).toHaveLength(1);
  });

  it("requires an explicit baseline-only initialization before network access", async () => {
    const root = await setupRoot();
    const fetchImpl = vi.fn();
    await expect(prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl })).rejects.toThrow(
      "baseline-only",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prepares an initial snapshot without changing the committed baseline or rendering nodes", async () => {
    const root = await setupRoot();
    const output = join(root, "github-output");
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => file() });
    const result = await prepare({
      root,
      env: { FIGMA_TOKEN: "token", FIGMA_BASELINE_ONLY: "true", GITHUB_OUTPUT: output },
      fetchImpl,
    });
    expect(result.changed).toBe(true);
    expect(result.changes.baselineInitialization).toBe(true);
    expect(result.changes.nodes).toEqual([]);
    expect(result.changes.coverage.variables).toBe("not-fetched-professional-plan");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(output, "utf8")).toBe("changed=true\nbaseline_only=true\n");
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

  it("writes only changed node contexts, reports removals, and preserves the committed baseline", async () => {
    const root = await setupRoot();
    const original = file();
    const baseline = createSnapshot(original).snapshot;
    await saveBaseline(root, baseline);
    const current = structuredClone(original);
    current.document.children[0].children[0].children[0].children[0].fillGeometry[0].path =
      "M0 0L25 25";
    current.document.children[1].children = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => current })
      .mockResolvedValueOnce({
        ok: true,
        json: () => ({ images: { "1:1": "https://s3-alpha.figma.com/example.png" } }),
      })
      .mockResolvedValueOnce(pngResponse());
    const result = await prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl });
    expect(result.changed).toBe(true);
    expect(result.changes.changed.map(({ id }) => id)).toEqual(["1:1"]);
    expect(result.changes.removed.map(({ id }) => id)).toEqual(["4:1"]);
    expect(result.changes.nodes).toEqual([
      { id: "1:1", kind: "ui", path: "test-results/figma-sync/nodes/1-1.json" },
    ]);
    expect(result.changes.sourceVersion).toBe("version-1");
    expect(result.changes.imageFiles).toEqual([
      { id: "1:1", path: "test-results/figma-sync/images/1-1.png" },
    ]);
    expect(validateChanges(result.changes)).toEqual(result.changes);
    const context = JSON.parse(await readFile(join(root, result.changes.nodes[0].path), "utf8"));
    expect(context.node.children[0].children[0].fillGeometry[0].path).toBe("M0 0L25 25");
    expect(
      JSON.parse(await readFile(join(root, "ds/automation/figma-baseline.json"), "utf8")),
    ).toEqual(baseline);
    expect(() =>
      validateChanges({
        ...result.changes,
        nodes: [{ ...result.changes.nodes[0], path: "../../escape" }],
      }),
    ).toThrow("context manifest");
  });

  it("reports unchanged state and refuses to reset an established baseline", async () => {
    const root = await setupRoot();
    await saveBaseline(root, createSnapshot(file()).snapshot);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => file() });
    const result = await prepare({ root, env: { FIGMA_TOKEN: "token" }, fetchImpl });
    expect(result.changed).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(
      prepare({ root, env: { FIGMA_TOKEN: "token", FIGMA_BASELINE_ONLY: "true" }, fetchImpl }),
    ).rejects.toThrow("cannot overwrite");
  });
});
