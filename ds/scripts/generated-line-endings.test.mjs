// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each(["token", "icon"])(
  "checks CRLF %s artifacts without rewriting them and rejects actual changes",
  (name) => {
    const root = mkdtempSync(join(tmpdir(), "comet-generated-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "figma"));
      copyFileSync(
        new URL(`../${name}/scripts/generate.mjs`, import.meta.url),
        join(root, "scripts/generate.mjs"),
      );
      const source = name === "token" ? "variables.json" : "icons.json";
      copyFileSync(
        new URL(`../${name}/figma/${source}`, import.meta.url),
        join(root, "figma", source),
      );
      const run = (...args) =>
        spawnSync(process.execPath, [join(root, "scripts/generate.mjs"), ...args], {
          encoding: "utf8",
          timeout: 10_000,
        });
      const generated = run();
      expect(generated.error).toBeUndefined();
      expect(generated.status, generated.stderr).toBe(0);
      const files = readdirSync(root, { recursive: true })
        .filter((path) => /\.(?:css|tsx?)$/.test(path))
        .map((path) => join(root, path));
      expect(files.length).toBeGreaterThan(0);
      for (const path of files) {
        writeFileSync(path, readFileSync(path, "utf8").replaceAll("\n", "\r\n"));
      }
      const before = files.map((path) => readFileSync(path));
      const checked = run("--check");
      expect(checked.error).toBeUndefined();
      expect(checked.status, checked.stderr).toBe(0);
      expect(files.map((path) => readFileSync(path))).toEqual(before);
      writeFileSync(files[0], "stale artifact\r\n");
      const changed = run("--check");
      expect(changed.error).toBeUndefined();
      expect(changed.status).not.toBe(0);
      expect(changed.stderr).toContain("stale");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
