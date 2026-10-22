import { expect, it, vi } from "vitest";

// Lazy surfaces must not bring CSS modules of their own: those would join the
// cascade only after the chunk loads. settingsSurfaceStyles keeps them eager.
it("keeps every lazy settings/preview CSS module in the eager App graph", async () => {
  const { existsSync, readFileSync } = await vi.importActual<{
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: "utf8"): string;
  }>("node:fs");
  const resolve = (from: string, specifier: string): string | null => {
    if (!specifier.startsWith(".")) return null;
    const parts = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    const base = parts.join("/");
    return (
      [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(existsSync) ??
      null
    );
  };
  const closure = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const [, specifier] of source.matchAll(
        /^\s*(?:import|export)\s(?:[^;]*?\sfrom\s)?["']([^"']+)["']/gm,
      )) {
        const target = resolve(file, specifier);
        if (target) visit(target);
      }
    };
    visit(entry);
    return seen;
  };
  const css = (files: Set<string>) => [...files].filter((file) => file.endsWith(".css.ts"));
  const eager = new Set(css(closure("src/App.tsx")));
  const lazy = [
    ...css(closure("src/components/SettingsPanel/SettingsPanel.tsx")),
    ...css(closure("src/components/DesktopPreview/DesktopPreview.tsx")),
  ];
  expect(lazy.length).toBeGreaterThan(0);
  expect([...new Set(lazy)].filter((file) => !eager.has(file))).toEqual([]);
});
