import { test as base, expect, type Page } from "@playwright/test";
import type { Snapshot } from "../src/types";

// Browser E2E for the real web UI. The Tauri backend is replaced by per-test handlers in Node,
// so scenarios can inject provider failures, catalogs and clocks without a native build.
export type Handler = (args: Record<string, unknown>) => unknown;
export type Call = { name: string; args: Record<string, unknown> };

export class FakeTauri {
  readonly calls: Call[] = [];
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly page: Page) {}

  handle(name: string, handler: Handler): void {
    this.handlers.set(name, handler);
  }

  called(name: string): Record<string, unknown>[] {
    return this.calls.filter((call) => call.name === name).map((call) => call.args);
  }

  // Loaded through Vite because the preview data imports app JSON that Node cannot load as-is.
  async previewSnapshot(): Promise<Snapshot> {
    return this.page.evaluate(async (path) => {
      const preview = await import(/* @vite-ignore */ path);
      return structuredClone(preview.PREVIEW_SNAPSHOT);
    }, "/src/previewSnapshot.ts");
  }

  async emit(event: string, payload: unknown): Promise<void> {
    await this.page.evaluate(
      ([name, data]) => (window as unknown as E2EWindow).__e2eEmit(name, data),
      [event, payload] as const,
    );
  }

  async open(view: string | null, params: Record<string, string> = {}): Promise<void> {
    const query = new URLSearchParams(view ? { view, ...params } : params);
    await this.page.goto(`/?${query}`);
  }

  async run(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    const handler = this.handlers.get(name);
    // Unhandled reads fail like a backend error so screens show their error state instead of
    // crashing on null; unhandled writes and notifications succeed silently.
    if (!handler)
      return /^(get|list|count)_/.test(name) ? { error: `E2E: ${name} 응답 없음` } : null;
    // Errors cross the binding as strings, matching how Tauri rejects commands.
    try {
      return { value: await handler(args) };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}

type E2EWindow = Window & { __e2eEmit: (event: string, payload: unknown) => void };

async function install(page: Page, fake: FakeTauri): Promise<void> {
  await page.exposeBinding("__e2eInvoke", (_source, name: string, args: Record<string, unknown>) =>
    fake.run(name, args ?? {}),
  );
  await page.addInitScript(() => {
    type Callback = (data: unknown) => void;
    const w = window as unknown as Record<string, unknown> & {
      __e2eInvoke: (
        name: string,
        args: unknown,
      ) => Promise<{ value?: unknown; error?: string } | null>;
    };
    const callbacks = new Map<number, Callback>();
    const listeners = new Map<string, number[]>();
    let next = 1;
    const view = new URLSearchParams(location.search).get("view") ?? "main";
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => callbacks.delete(id),
    };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: view },
        currentWebview: { windowLabel: view, label: view },
      },
      transformCallback(callback: Callback, once = false) {
        const id = next++;
        callbacks.set(id, (data) => {
          if (once) callbacks.delete(id);
          callback?.(data);
        });
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
      async invoke(name: string, args: Record<string, unknown> = {}) {
        if (name === "plugin:event|listen") {
          const event = args.event as string;
          listeners.set(event, [...(listeners.get(event) ?? []), args.handler as number]);
          return args.handler;
        }
        if (name === "plugin:event|unlisten") {
          const event = args.event as string;
          listeners.set(
            event,
            (listeners.get(event) ?? []).filter((id) => id !== args.eventId),
          );
          return null;
        }
        if (name.startsWith("plugin:")) return null;
        const result = await w.__e2eInvoke(name, args);
        if (result?.error !== undefined) throw result.error;
        return result?.value ?? null;
      },
    };
    w.__e2eEmit = (event: string, payload: unknown) => {
      for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
    };
  });
}

export const test = base.extend<{ tauri: FakeTauri }>({
  tauri: async ({ page }, use) => {
    const fake = new FakeTauri(page);
    await install(page, fake);
    await use(fake);
  },
});

export { expect };
