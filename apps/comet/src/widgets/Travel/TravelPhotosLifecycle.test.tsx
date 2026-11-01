import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { TravelPhotos, useTravelPhotoImport } from "./TravelPhotos";
import type { TripData } from "./travelTypes";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: String,
}));
const trip: TripData = {
  travel: {
    id: "trip", title: "제주", destination: "", startDate: "2026-11-01", endDate: "2026-11-02",
    timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false,
  },
  plans: [], bookings: [], expenses: [], people: [], transfers: [], photos: [],
};
const metas = ["one", "two"].map((path) => ({
  path, takenAt: null, offsetMinutes: null, lat: null, lng: null,
}));

function Harness({ current, showPhotos, mutate }: {
  current: TripData;
  showPhotos: boolean;
  mutate: (action: string, input: Record<string, unknown>) => Promise<boolean>;
}): React.ReactElement {
  const photoImport = useTravelPhotoImport(mutate, () => undefined);
  return <>
    {photoImport.progress && <p role="status">{photoImport.progress.travelTitle} · {photoImport.progress.message}</p>}
    {showPhotos && <TravelPhotos trip={current} busy={false} mutate={mutate} onOverview={() => undefined}
      onFailure={() => undefined} adding={photoImport.progress?.inProgress ?? false} onAdd={() => void photoImport.add(current)} />}
  </>;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("continues after switching tabs and trips, and saves to the original trip", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return new Promise((resolve) => { finish = resolve; });
    if (name === "travel_photo_original") throw new Error("no preview");
    return null as never;
  });
  const mutate = vi.fn().mockResolvedValue(true);
  const view = render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  expect(screen.getByRole("status").textContent).toContain("제주 · 사진을 고르는 중이에요.");
  view.rerender(<Harness current={{ ...trip, travel: { ...trip.travel, id: "other", title: "서울" } }} showPhotos={false} mutate={mutate} />);
  await act(async () => finish(metas));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate).toHaveBeenCalledWith("travel-photo-add", expect.objectContaining({ travelId: "trip", photos: expect.arrayContaining([expect.objectContaining({ path: "one" })]) }));
  expect(screen.getByRole("status").textContent).toContain("제주 · 사진 2장 처리를 마쳤어요.");
});

it("stops further work when the travel window closes during the picker", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const mutate = vi.fn();
  const view = render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  view.unmount();
  await act(async () => finish(metas));
  expect(command).toHaveBeenCalledTimes(1);
  expect(mutate).not.toHaveBeenCalled();
});

it("does not write a thumbnail after the travel window closes during decoding", async () => {
  let finish!: () => void;
  const decode = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  vi.stubGlobal("Image", class { decode = decode; src = ""; naturalWidth = 100; naturalHeight = 100; });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:qa"), revokeObjectURL: vi.fn() });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return metas as never;
    if (name === "travel_photo_original") return new ArrayBuffer(1) as never;
    throw new Error(`Unexpected command: ${name}`);
  });
  const mutate = vi.fn();
  const view = render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(decode).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => finish());
  expect(command).not.toHaveBeenCalledWith("travel_save_thumb", expect.anything());
  expect(mutate).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qa");
});

it("allows a live import to finish normally without changing selected originals", async () => {
  vi.stubGlobal("Image", class { decode = async () => undefined; src = ""; naturalWidth = 100; naturalHeight = 100; });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:qa"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,QA");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return metas as never;
    if (name === "travel_photo_original") return new ArrayBuffer(1) as never;
    if (name === "travel_save_thumb") return "preview.jpg" as never;
    return null as never;
  });
  const mutate = vi.fn().mockResolvedValue(true);
  render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate).toHaveBeenCalledWith("travel-photo-add", expect.objectContaining({
    travelId: "trip",
    photos: [
      expect.objectContaining({ path: "one", thumb: "preview.jpg" }),
      expect.objectContaining({ path: "two", thumb: "preview.jpg" }),
    ],
  }));
  expect(command).toHaveBeenCalledWith("travel_save_thumb", { travelId: "trip", data: "QA" });
});

it("does not start further work when an already-issued thumbnail write finishes after close", async () => {
  let finish!: (value: string) => void;
  vi.stubGlobal("Image", class { decode = async () => undefined; src = ""; naturalWidth = 100; naturalHeight = 100; });
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:qa"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,QA");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return metas as never;
    if (name === "travel_photo_original") return new ArrayBuffer(1) as never;
    if (name === "travel_save_thumb") return new Promise<string>((resolve) => { finish = resolve; }) as never;
    return null as never;
  });
  const mutate = vi.fn();
  const view = render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(command).toHaveBeenCalledWith("travel_save_thumb", expect.anything()));
  view.unmount();
  await act(async () => finish("preview.jpg"));
  expect(command).toHaveBeenCalledTimes(3);
  expect(mutate).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qa");
});

it("clears progress when the picker is cancelled", async () => {
  vi.mocked(command).mockResolvedValue([] as never);
  render(<Harness current={trip} showPhotos mutate={vi.fn()} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
});

it("reports the number saved when a later batch fails", async () => {
  const many = Array.from({ length: 101 }, (_, index) => ({ ...metas[0], path: String(index) }));
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return many as never;
    if (name === "travel_photo_original") throw new Error("no preview");
    return null as never;
  });
  const mutate = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  render(<Harness current={trip} showPhotos mutate={mutate} />);
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("100/101장 처리했어요."));
  expect(mutate).toHaveBeenCalledTimes(2);
});
