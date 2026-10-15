import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Ledger12MonthForecast,
  LedgerCategorySummary,
  LedgerCategoryTile,
  LedgerDayHeader,
  LedgerMonthlyBudget,
  LedgerQuickAdd,
  LedgerRecurringCosts,
  LedgerRecurringRow,
  LedgerRow,
  type LedgerQuickAddValue,
  type LedgerRecurringRowProps,
} from "@comet/ui";

const categories = [
  { value: "cafe", label: "카페" },
  { value: "food", label: "식비" },
  { value: "transport", label: "교통" },
];
const recurring: (LedgerRecurringRowProps & { id: string })[] = [
  {
    id: "phone",
    title: "통신비",
    description: "매달 15일 · 통신",
    amount: "49,500원",
    date: "10월 15일 (목)",
    dateDetail: "3일 뒤",
    category: "telecom",
    icon: "phone",
  },
  {
    id: "housing",
    title: "관리비",
    description: "매달 말일 · 주거 · 금액은 지난 확인",
    amount: "126,400원",
    estimated: true,
    date: "10월 31일 (토)",
    dateDetail: "19일 뒤",
    category: "housing",
    icon: "home",
  },
];
function QuickAddExample(): JSX.Element {
  const [added, setAdded] = useState<LedgerQuickAddValue>();
  return (
    <div className="comet-catalog-stack">
      <LedgerQuickAdd
        categories={categories}
        defaultAmount="4,500"
        defaultCategory="cafe"
        onAdd={setAdded}
      />
      {added && (
        <output aria-live="polite">
          {added.amount}원 · {added.category} · {added.memo}
        </output>
      )}
    </div>
  );
}
const meta = {
  title: "UI/Planner/Ledger",
  component: LedgerRow,
  tags: ["autodocs"],
  argTypes: {
    title: { control: "text" },
    description: { control: "text" },
    amount: { control: "text" },
    category: {
      control: "select",
      options: [
        "food",
        "delivery",
        "cafe",
        "transport",
        "living",
        "culture",
        "housing",
        "telecom",
        "subscription",
      ],
    },
  },
  args: { title: "점심 김치찌개", description: "식비", amount: "9,000원" },
  parameters: {
    docs: {
      description: {
        component:
          "금액·분류·예약일을 전달하는 표시 컴포넌트입니다. 원 단위 표기와 날짜 형식은 소비자가 결정합니다. QuickAdd는 native form 검증 뒤 원문 amount/category/memo를 onAdd로 전달합니다. 예산·예측의 수치는 props이며 계좌 연결이나 실제 지출 저장은 포함하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof LedgerRow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Row: Story = { name: "Row" };
export const CategoryTile: Story = {
  parameters: { controls: { disable: true } },
  name: "Category Tile",
  render: () => (
    <div className="comet-catalog-row">
      <LedgerCategoryTile category="food" icon="bowl" />
      <LedgerCategoryTile category="telecom" icon="phone" />
      <LedgerCategoryTile category="housing" icon="home" />
    </div>
  ),
};
export const DayHeader: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Header",
  render: () => (
    <div style={{ width: 520 }}>
      <LedgerDayHeader title="오늘 · 10월 12일 월요일" amount="23,600원" />
    </div>
  ),
};
export const QuickAdd: Story = {
  parameters: { controls: { disable: true } },
  name: "Quick Add · 입력과 추가",
  render: () => <QuickAddExample />,
};
export const Forecast: Story = {
  parameters: { controls: { disable: true } },
  name: "12 Month Forecast",
  render: () => (
    <Ledger12MonthForecast
      months={Array.from({ length: 12 }, (_, index) => ({
        id: String(index),
        label: String(((index + 9) % 12) + 1),
        recurring: 65 + (index % 4) * 4,
        occasional: index % 3 === 0 ? 12 : 0,
        valueLabel: index === 0 ? "95만" : index === 11 ? "112만" : undefined,
      }))}
    />
  ),
};
export const MonthlyBudget: Story = {
  parameters: { controls: { disable: true } },
  name: "Monthly Budget",
  render: () => (
    <LedgerMonthlyBudget
      title="10월에 쓴 돈 · 고정비 빼고"
      spent={612400}
      budget={900000}
      amountLabel="612,400원"
      budgetLabel="예산 900,000원 중 68%"
      remainingLabel="287,600원 남음"
      detail="남은 19일 동안 하루 약 15,100원"
    />
  ),
};
export const EmptyBudget: Story = {
  parameters: { controls: { disable: true } },
  name: "Monthly Budget · 예산 없음",
  render: () => (
    <LedgerMonthlyBudget title="예산을 정해 주세요" spent={0} budget={0} amountLabel="0원" />
  ),
};
export const CategorySummary: Story = {
  parameters: { controls: { disable: true } },
  name: "Category Summary",
  render: () => (
    <LedgerCategorySummary
      items={[
        { id: "food", label: "식비", amount: 245000, amountLabel: "245,000원", category: "food" },
        {
          id: "delivery",
          label: "배달",
          amount: 134700,
          amountLabel: "134,700원",
          category: "delivery",
        },
        { id: "cafe", label: "카페", amount: 85700, amountLabel: "85,700원", category: "cafe" },
        {
          id: "transport",
          label: "교통",
          amount: 67400,
          amountLabel: "67,400원",
          category: "transport",
        },
        { id: "living", label: "생활", amount: 49000, amountLabel: "49,000원", category: "living" },
        {
          id: "culture",
          label: "문화",
          amount: 30600,
          amountLabel: "30,600원",
          category: "culture",
        },
      ]}
    />
  ),
};
export const RecurringRow: Story = {
  parameters: { controls: { disable: true } },
  name: "Recurring Row · 고정/예상",
  render: () => (
    <div style={{ width: 600 }}>
      {recurring.map(({ id, ...item }) => (
        <LedgerRecurringRow key={id} {...item} />
      ))}
    </div>
  ),
};
export const RecurringCosts: Story = {
  parameters: { controls: { disable: true } },
  name: "Recurring Costs",
  render: () => <LedgerRecurringCosts items={recurring} summary="한 달 평균 약 175,900원" />,
};
