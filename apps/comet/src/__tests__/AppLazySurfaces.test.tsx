import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "../App";
import { PREVIEW_SNAPSHOT, useSnapshot } from "../hooks/useSnapshot";

const loaded = vi.hoisted(() => ({ settings: vi.fn(), preview: vi.fn(), desktop: true }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  useSnapshot: vi.fn(),
  isDesktop: () => loaded.desktop,
}));
vi.mock("../components/FaceTag/FaceTag", () => ({ FaceTag: () => <p>face ready</p> }));
vi.mock("../components/SettingsPanel/SettingsPanel", () => {
  loaded.settings();
  return {
    SettingsPanel: function Draft() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="settings draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    },
  };
});
vi.mock("../components/DesktopPreview/DesktopPreview", () => {
  loaded.preview();
  return { DesktopPreview: () => <p>browser preview ready</p> };
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("defers both surfaces, preserves the mounted settings draft, and opens browser preview", async () => {
  vi.mocked(useSnapshot).mockReturnValue({
    snapshot: PREVIEW_SNAPSHOT,
    error: null,
    reload: vi.fn(),
  });
  window.history.replaceState(null, "", "/?face=builtin-a");
  const { rerender } = render(<App />);
  expect(screen.getByText("face ready")).toBeTruthy();
  expect(loaded.settings).not.toHaveBeenCalled();
  expect(loaded.preview).not.toHaveBeenCalled();

  window.history.replaceState(null, "", "/?view=settings");
  rerender(<App />);
  const draft = await screen.findByRole("textbox", { name: "settings draft" });
  fireEvent.change(draft, { target: { value: "keep this unsaved" } });
  vi.mocked(useSnapshot).mockReturnValue({
    snapshot: { ...PREVIEW_SNAPSHOT },
    error: null,
    reload: vi.fn(),
  });
  rerender(<App />);
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("keep this unsaved");
  expect(loaded.settings).toHaveBeenCalledOnce();
  expect(loaded.preview).not.toHaveBeenCalled();

  loaded.desktop = false;
  window.history.replaceState(null, "", "/");
  rerender(<App />);
  expect(await screen.findByText("browser preview ready")).toBeTruthy();
  expect(loaded.preview).toHaveBeenCalledOnce();
});
