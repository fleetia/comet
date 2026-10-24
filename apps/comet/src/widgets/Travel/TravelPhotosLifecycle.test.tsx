import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { TravelPhotos } from "./TravelPhotos";
import type { TripData } from "./travelTypes";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: String,
}));
const trip: TripData = {
  travel: {
    id: "trip",
    title: "QA",
    destination: "",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    timeZone: "Asia/Seoul",
    currency: "KRW",
    budget: 0,
    finished: false,
  },
  plans: [],
  bookings: [],
  expenses: [],
  people: [],
  transfers: [],
  photos: [],
};
const metas = ["one", "two"].map((path) => ({
  path,
  takenAt: null,
  offsetMinutes: null,
  lat: null,
  lng: null,
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("does not start decoding after a picker resolves for a closed view", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const mutate = vi.fn();
  const view = render(
    <TravelPhotos
      trip={trip}
      busy={false}
      mutate={mutate}
      onOverview={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("사진 넣기"));
  view.unmount();
  await act(async () => finish(metas));
  expect(command).toHaveBeenCalledTimes(1);
  expect(mutate).not.toHaveBeenCalled();
});

it.each(["unmount", "change-trip"])(
  "stops after delayed decode on %s, without writing thumbnails or importing",
  async (reason) => {
    let finishDecode!: () => void;
    const decode = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDecode = resolve;
        }),
    );
    vi.stubGlobal(
      "Image",
      class {
        decode = decode;
        src = "";
        naturalWidth = 100;
        naturalHeight = 100;
      },
    );
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:qa"), revokeObjectURL: vi.fn() });
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "travel_pick_photos") return metas as never;
      if (name === "travel_photo_original") return new ArrayBuffer(1) as never;
      throw new Error(`Unexpected native write: ${name}`);
    });
    const mutate = vi.fn();
    const props = { busy: false, mutate, onOverview: vi.fn(), onFailure: vi.fn() };
    const view = render(<TravelPhotos {...props} trip={trip} />);
    fireEvent.click(screen.getByText("사진 넣기"));
    await waitFor(() => expect(decode).toHaveBeenCalledOnce());
    if (reason === "unmount") view.unmount();
    else
      view.rerender(
        <TravelPhotos {...props} trip={{ ...trip, travel: { ...trip.travel, id: "new-trip" } }} />,
      );
    await act(async () => finishDecode());
    expect(command).not.toHaveBeenCalledWith("travel_save_thumb", expect.anything());
    expect(command).toHaveBeenCalledTimes(2);
    expect(mutate).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qa");
  },
);

it("allows a live import to finish normally without changing selected originals", async () => {
  vi.stubGlobal(
    "Image",
    class {
      decode = async () => undefined;
      src = "";
      naturalWidth = 100;
      naturalHeight = 100;
    },
  );
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
  render(
    <TravelPhotos
      trip={trip}
      busy={false}
      mutate={mutate}
      onOverview={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
  expect(mutate.mock.calls[0][0]).toBe("travel-photo-add");
  expect(mutate.mock.calls[0][1]).toMatchObject({
    travelId: "trip",
    photos: [
      { path: "one", thumb: "preview.jpg" },
      { path: "two", thumb: "preview.jpg" },
    ],
  });
  expect(command).toHaveBeenCalledWith("travel_save_thumb", { travelId: "trip", data: "QA" });
});

it("does not start further work when an already-issued thumbnail write finishes after close", async () => {
  let finish!: (value: string) => void;
  vi.stubGlobal(
    "Image",
    class {
      decode = async () => undefined;
      src = "";
      naturalWidth = 100;
      naturalHeight = 100;
    },
  );
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:qa"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,QA");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "travel_pick_photos") return metas as never;
    if (name === "travel_photo_original") return new ArrayBuffer(1) as never;
    if (name === "travel_save_thumb")
      return new Promise<string>((resolve) => {
        finish = resolve;
      }) as never;
    return null as never;
  });
  const mutate = vi.fn();
  const view = render(
    <TravelPhotos
      trip={trip}
      busy={false}
      mutate={mutate}
      onOverview={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByText("사진 넣기"));
  await waitFor(() => expect(command).toHaveBeenCalledWith("travel_save_thumb", expect.anything()));
  view.unmount();
  await act(async () => finish("preview.jpg"));
  expect(command).toHaveBeenCalledTimes(3);
  expect(mutate).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qa");
});
