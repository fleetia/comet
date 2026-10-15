import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { CheckboxRow, RadioRow, SelectField } from "./ExtendedSelections";
import { ColorControl } from "./ColorControl";
afterEach(cleanup);
it("checkbox rows preserve native label activation, disabled state and descriptions", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <>
      <CheckboxRow
        label="記録を共有"
        description="選んだ記録だけ"
        layout="export"
        onChange={change}
      />
      <CheckboxRow label="固定" disabled defaultChecked />
    </>,
  );
  await user.click(screen.getByText("記録を共有"));
  const checkbox = screen.getByRole("checkbox", { name: "記録を共有" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  expect(change).toHaveBeenCalledOnce();
  expect(
    document.getElementById(checkbox.getAttribute("aria-describedby") ?? "")?.textContent,
  ).toBe("選んだ記録だけ");
  await user.click(screen.getByRole("checkbox", { name: "固定" }));
  expect(change).toHaveBeenCalledOnce();
});
it("radio rows keep native mutual exclusion and leading artwork decorative", async () => {
  render(
    <>
      <RadioRow
        name="program"
        label="하나"
        value="a"
        leading={<span>장식</span>}
        layout="app-usage"
        defaultChecked
      />
      <RadioRow name="program" label="둘" value="b" layout="option" />
    </>,
  );
  await userEvent.setup().click(screen.getByRole("radio", { name: "둘" }));
  expect((screen.getByRole("radio", { name: "하나" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("radio", { name: "둘" }) as HTMLInputElement).checked).toBe(true);
});
it("select fields keep the associated label, ref and native change semantics", async () => {
  const ref = createRef<HTMLSelectElement>();
  const change = vi.fn();
  render(
    <SelectField
      ref={ref}
      label="목록"
      leading={<span>장식</span>}
      defaultValue="a"
      onChange={change}
    >
      <option value="a">일</option>
      <option value="b">생활</option>
    </SelectField>,
  );
  const select = screen.getByRole("combobox", { name: "목록" });
  expect(ref.current).toBe(select);
  await userEvent.setup().selectOptions(select, "b");
  expect(ref.current?.value).toBe("b");
  expect(change).toHaveBeenCalledOnce();
});
it("color controls expose native range bounds and form values", () => {
  render(
    <form aria-label="색상">
      <ColorControl label="색상각" name="hue" defaultValue={168} />
      <ColorControl label="명도" appearance="lightness" defaultValue={45} disabled />
    </form>,
  );
  const hue = screen.getByRole("slider", { name: "색상각" }) as HTMLInputElement;
  expect(hue.min).toBe("0");
  expect(hue.max).toBe("360");
  expect(hue.valueAsNumber).toBe(168);
  expect((screen.getByRole("slider", { name: "명도" }) as HTMLInputElement).disabled).toBe(true);
  expect(
    new FormData(screen.getByRole("form", { name: "색상" }) as HTMLFormElement).get("hue"),
  ).toBe("168");
});
it("hue thumbs follow native changes and form resets while lightness keeps its base hue", async () => {
  render(
    <form>
      <ColorControl label="색상각" defaultValue={168} />
      <ColorControl label="명도" appearance="lightness" hue={220} defaultValue={45} />
      <button type="reset">초기화</button>
    </form>,
  );
  const hue = screen.getByRole("slider", { name: "색상각" }) as HTMLInputElement;
  fireEvent.change(hue, { target: { value: "300" } });
  expect(hue.style.getPropertyValue("--comet-color-control-hue")).toBe("300");
  const lightness = screen.getByRole("slider", { name: "명도" }) as HTMLInputElement;
  fireEvent.change(lightness, { target: { value: "80" } });
  expect(lightness.style.getPropertyValue("--comet-color-control-hue")).toBe("220");
  await userEvent.setup().click(screen.getByRole("button", { name: "초기화" }));
  expect(hue.valueAsNumber).toBe(168);
  expect(hue.style.getPropertyValue("--comet-color-control-hue")).toBe("168");
});
