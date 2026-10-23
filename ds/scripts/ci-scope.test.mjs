// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { arePathsDsOnly, classifyPaths, getChangeScope, getComparison } from "./ci-scope.mjs";

const repositories = [];
const dsScope = { dsOnly: true, nativeRequired: false, bundleRequired: false };
const frontendScope = { dsOnly: false, nativeRequired: false, bundleRequired: false };
const nativeScope = { dsOnly: false, nativeRequired: true, bundleRequired: false };
const fullScope = { dsOnly: false, nativeRequired: true, bundleRequired: true };

afterEach(() => {
  for (const directory of repositories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "comet-ci-scope-"));
  repositories.push(cwd);
  function git(...args) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  function write(path, value = path) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
  }
  function commit() {
    git("add", "--all");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  }
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "CI scope test");
  git("config", "user.email", "ci-scope@example.invalid");
  git("config", "commit.gpgsign", "false");
  write("apps/comet/src/App.tsx");
  write("apps/comet/src-tauri/src/lib.rs");
  write("ds/ui/button.ts");
  const base = commit();
  return { cwd, git, write, commit, base };
}

describe("CI change scope", () => {
  it("allows only a nonempty set of design system paths", () => {
    expect(arePathsDsOnly(["ds/ui/button.ts", "ds/token/values.json", "vitest.ds.config.ts"])).toBe(
      true,
    );
    for (const paths of [
      [],
      ["ds/ui/button.ts", "apps/comet/src/App.tsx"],
      ["ds/scripts/ci-scope.mjs"],
      ["ds-other/file.ts"],
    ]) {
      expect(arePathsDsOnly(paths)).toBe(false);
    }
  });

  it.each([
    {
      name: "design system changes",
      paths: ["ds/ui/src/Button.tsx", "ds/token/values.json", "vitest.ds.config.ts"],
      expected: dsScope,
    },
    {
      name: "frontend source and build configuration",
      paths: [
        "apps/comet/src/App.tsx",
        "apps/comet/public/avatar.svg",
        "apps/comet/index.html",
        "apps/comet/vite.config.ts",
        "apps/comet/tsconfig.json",
        "apps/comet/tsconfig.node.json",
        "tsconfig.json",
        "vitest.release.config.ts",
      ],
      expected: frontendScope,
    },
    {
      name: "native source and embedded content",
      paths: [
        "apps/comet/src-tauri/src/lib.rs",
        "apps/comet/src-tauri/native/bridge.swift",
        "apps/comet/src-tauri/content/greetings.json",
        "apps/comet/src-tauri/story/opening.talk",
        "apps/comet/src-tauri/examples/probe.rs",
        "apps/comet/src-tauri/tests/playback.rs",
        "apps/comet/crates/comet-nlp/src/lib.rs",
        "apps/comet/crates/comet-nlp/tests/tokenize.rs",
        "apps/comet/crates/comet-nlp/examples/tokenize.rs",
      ],
      expected: nativeScope,
    },
    {
      name: "app resources consumed by native checks",
      paths: [
        "apps/comet/talk/packs/example.talk",
        "apps/comet/integrations/spicetify/index.js",
        "apps/comet/widgets/catalog.json",
        "apps/comet/character-packs/sample/manifest.json",
        "apps/comet/nlp/dictionary.json",
        "apps/comet/resources/defaults.json",
      ],
      expected: nativeScope,
    },
    {
      name: "mixed design system and frontend changes",
      paths: ["ds/ui/src/Button.tsx", "apps/comet/src/widgets/Travel/Travel.tsx"],
      expected: frontendScope,
    },
    {
      name: "frontend changes with release notes and root documentation",
      paths: ["apps/comet/src/App.tsx", ".changeset/ui-update.md", "README.md", "LICENSE"],
      expected: frontendScope,
    },
    {
      name: "mixed frontend and native changes",
      paths: ["apps/comet/src/App.tsx", "apps/comet/src-tauri/src/lib.rs"],
      expected: nativeScope,
    },
  ])("classifies $name", ({ paths, expected }) => {
    expect(classifyPaths(paths)).toEqual(expected);
  });

  it.each([
    "apps/comet/src/widgets/desktopKinds.json",
    "apps/comet/src/widgets/Travel/travelMoney.fixtures.json",
  ])("keeps native checks for frontend JSON imported by native code: %s", (path) => {
    expect(classifyPaths([path])).toEqual(nativeScope);
  });

  it.each([
    "apps/comet/src-tauri/Cargo.toml",
    "apps/comet/crates/comet-nlp/Cargo.lock",
    "apps/comet/src-tauri/build.rs",
    "apps/comet/src-tauri/tauri.conf.json",
    "apps/comet/src-tauri/capabilities/default.json",
    "apps/comet/src-tauri/icons/icon.png",
    "apps/comet/package.json",
    "pnpm-lock.yaml",
    "apps/comet/scripts/verify.mjs",
    ".github/workflows/verify.yml",
    "ds/scripts/ci-scope.mjs",
    ".cargo/config.toml",
  ])("requires compilation and packaging for %s", (path) => {
    expect(classifyPaths(["apps/comet/src/App.tsx", path])).toEqual(fullScope);
  });

  it("keeps empty and unknown path sets on the full verification path", () => {
    expect(classifyPaths([])).toEqual(fullScope);
    expect(classifyPaths(["ds-other/file.ts"])).toEqual(fullScope);
    expect(classifyPaths(["apps/comet/src-other/file.ts"])).toEqual(fullScope);
  });

  it("classifies real Git diffs and keeps both sides of a frontend-to-DS rename", () => {
    const repo = createRepository();
    repo.write("ds/ui/button.ts", "updated");
    const dsHead = repo.commit();
    expect(getChangeScope("push", { before: repo.base, after: dsHead }, repo.cwd)).toEqual(dsScope);

    renameSync(join(repo.cwd, "apps/comet/src/App.tsx"), join(repo.cwd, "ds/ui/App.tsx"));
    const renamedHead = repo.commit();
    expect(getChangeScope("push", { before: dsHead, after: renamedHead }, repo.cwd)).toEqual(
      frontendScope,
    );
  });

  it("keeps native checks when a native file is moved into frontend source", () => {
    const repo = createRepository();
    renameSync(
      join(repo.cwd, "apps/comet/src-tauri/src/lib.rs"),
      join(repo.cwd, "apps/comet/src/moved.rs"),
    );
    const head = repo.commit();
    expect(getChangeScope("push", { before: repo.base, after: head }, repo.cwd)).toEqual(
      nativeScope,
    );
  });

  it("uses the PR merge base so unrelated base branch edits do not change its scope", () => {
    const repo = createRepository();
    repo.git("checkout", "--quiet", "-b", "design-change");
    repo.write("ds/ui/button.ts", "updated");
    const head = repo.commit();
    repo.git("checkout", "--quiet", "main");
    repo.write("apps/comet/src-tauri/src/lib.rs", "unrelated main change");
    const base = repo.commit();
    expect(
      getChangeScope(
        "pull_request",
        { pull_request: { base: { sha: base }, head: { sha: head } } },
        repo.cwd,
      ),
    ).toEqual(dsScope);
  });

  it("fails closed for manual runs, malformed events, unavailable commits and empty diffs", () => {
    const repo = createRepository();
    const event = { before: repo.base, after: repo.base };
    expect(getChangeScope("workflow_dispatch", event, repo.cwd)).toEqual(fullScope);
    expect(getChangeScope("push", event, repo.cwd)).toEqual(fullScope);
    expect(getChangeScope("push", { ...event, after: "f".repeat(40) }, repo.cwd)).toEqual(
      fullScope,
    );
    expect(getChangeScope("push", { ...event, before: "0".repeat(40) }, repo.cwd)).toEqual(
      fullScope,
    );
    expect(getChangeScope("pull_request", {}, repo.cwd)).toEqual(fullScope);
    expect(getComparison("pull_request", {})).toBeNull();
    expect(getComparison("push", { ...event, before: "--output=unexpected" })).toBeNull();
  });

  describe("real usage patterns", () => {
    it("prints all GitHub Actions outputs for a frontend push and a manual run", () => {
      const repo = createRepository();
      repo.write("apps/comet/src/App.tsx", "updated");
      const head = repo.commit();
      const eventPath = join(repo.cwd, "event.json");
      writeFileSync(eventPath, JSON.stringify({ before: repo.base, after: head }));
      const scriptPath = fileURLToPath(new URL("./ci-scope.mjs", import.meta.url));
      for (const [eventName, expected] of [
        ["push", "ds_only=false\nnative_required=false\nbundle_required=false\n"],
        ["workflow_dispatch", "ds_only=false\nnative_required=true\nbundle_required=true\n"],
      ]) {
        const output = execFileSync(process.execPath, [scriptPath], {
          cwd: repo.cwd,
          encoding: "utf8",
          env: { ...process.env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath },
        });
        expect(output).toBe(expected);
      }
    });
  });
});
