import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { Checkbox } from "@comet/ui";

const meta = {
  title: "UI/Inputs/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  args: {
    label: "자동 잡담 사용",
    description: "필요할 때 조용히 말을 걸어요.",
    disabled: false,
    indeterminate: false,
    shape: "square",
  },
  argTypes: {
    shape: { control: "radio", options: ["square", "round"] },
    label: { control: "text" },
    description: { control: "text" },
    error: { control: "text" },
  },
  parameters: {
    docs: {
      description: {
        component:
          "native checkbox입니다. Tab으로 이동하고 Space로 선택합니다. defaultChecked 또는 checked·onChange를 사용하며 indeterminate는 여러 항목의 일부만 선택되었음을 표현합니다. 레이블을 클릭해도 입력이 활성화됩니다.",
      },
    },
  },
} satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "꺼짐" };
export const Checked: Story = { name: "켜짐", args: { defaultChecked: true } };
export const Round: Story = { name: "원형", args: { shape: "round", defaultChecked: true } };
export const Mixed: Story = {
  name: "일부 선택",
  args: { label: "모든 알림", indeterminate: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const user = userEvent.setup({ document: canvasElement.ownerDocument });
    const checkbox = canvas.getByRole("checkbox", { name: "모든 알림" });
    const [checkIcon, mixedIcon] = checkbox.parentElement?.querySelectorAll("svg") ?? [];

    await expect(checkbox).toBePartiallyChecked();
    await expect(checkIcon).not.toBeVisible();
    await expect(mixedIcon).toBeVisible();

    await user.click(checkbox);
    await expect(checkbox).toBeChecked();
    await expect(checkbox).not.toBePartiallyChecked();
    await expect(checkIcon).toBeVisible();
    await expect(mixedIcon).not.toBeVisible();

    await user.click(checkbox);
    await expect(checkbox).not.toBeChecked();
    await expect(checkIcon).not.toBeVisible();
    await expect(mixedIcon).not.toBeVisible();

    if (checkbox instanceof HTMLInputElement) {
      checkbox.indeterminate = true;
    }
  },
};
export const Invalid: Story = { name: "오류", args: { error: "계속하려면 선택해 주세요." } };
export const Disabled: Story = { name: "비활성", args: { disabled: true } };
