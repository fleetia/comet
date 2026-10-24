import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as fields from "../../../../../ds/ui/src/controls/fields.css";
import { TravelEditor } from "./TravelEditor";
import type { Travel } from "./travelTypes";

afterEach(cleanup);

it("fills the envelope field without changing its existing selection or other select layouts", async () => {
  const travel: Travel = {
    id: "trip",
    title: "QA island walk",
    destination: "Island",
    startDate: "2026-11-07",
    endDate: "2026-11-09",
    timeZone: "Asia/Seoul",
    currency: "KRW",
    budget: 0,
    finished: false,
    envelopeId: "existing",
  };
  const title = "QA packing pouch with a long existing envelope title";
  const onSave = vi.fn().mockResolvedValue(false);
  const onClose = vi.fn();
  render(
    <TravelEditor
      travel={travel}
      envelopes={[{ id: "existing", title }]}
      busy={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  const select = screen.getByLabelText("준비 봉투") as HTMLSelectElement;
  expect(select.classList.contains(fields.fillSelect)).toBe(true);
  expect(select.parentElement?.classList.contains(fields.fillSelectContainer)).toBe(true);
  expect(select.parentElement?.parentElement?.classList.contains(fields.fillField)).toBe(true);
  expect(select.value).toBe("existing");
  expect(screen.getByRole("option", { name: title }).textContent).toBe(title);
  for (const name of ["그곳 시간대", "결제 통화"]) {
    expect(screen.getByLabelText(name).classList.contains(fields.fillSelect)).toBe(false);
  }
  fireEvent.change(select, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({ envelopeId: "" });
  fireEvent.change(select, { target: { value: "existing" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1][0]).toMatchObject({
    envelopeId: "existing",
    title: travel.title,
    timeZone: travel.timeZone,
    currency: travel.currency,
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(select.value).toBe("existing");
});
