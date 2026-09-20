import { Button, Checkbox, DateField, FormField, Select } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { localDay, text, type DataRecord, type ToolAction } from "../toolData";
import { PLANNER_TEMPLATES, templateItems } from "./templateCatalog";
import { PERIODS, periodAnchor, repeatLabel } from "./plannerData";
import * as s from "./planner.css";

export function PlannerTemplates({ act, busy }: { act: ToolAction; busy: boolean }): ReactElement {
  const [selected, setSelected] = useState(PLANNER_TEMPLATES[0]);
  const [base, setBase] = useState(localDay());
  const [items, setItems] = useState(() => templateItems(selected, base));
  const [checked, setChecked] = useState([0, 1, 2, 3]);
  const [period, setPeriod] = useState<string>(selected.period);
  const [saved, setSaved] = useState(false);
  function patch(index: number, values: DataRecord): void {
    setItems((before) => before.map((item, i) => (i === index ? { ...item, ...values } : item)));
    setSaved(false);
  }
  return (
    <fieldset disabled={busy} className={s.form} style={{border: 0, padding: 0, margin: 0, minWidth: 0}}>
      <p className={s.caption}>필요한 항목과 주기를 골라 내 할 일에 추가하세요.</p>
      <div className={s.templateLayout}>
        <nav className={s.category} aria-label="템플릿 종류">
          {PLANNER_TEMPLATES.map((template) => (
            <Button
              key={template.id}
              variant="quiet"
              size="compact"
              className={s.categoryButton}
              aria-pressed={selected.id === template.id}
              onClick={() => {
                setSelected(template);
                setItems(templateItems(template, base));
                setChecked([0, 1, 2, 3]);
                setPeriod(template.period);
                setSaved(false);
              }}
            >
              {template.title}
            </Button>
          ))}
          <p className={s.caption}>
            추가한 뒤에도
            <br />
            자유롭게 수정할 수 있어요.
          </p>
        </nav>
        <form
          className={s.form}
          onSubmit={async (event) => {
            event.preventDefault();
            const chosen = items
              .filter((_, i) => checked.includes(i))
              .map((item) => ({
                ...item,
                planPeriod: period,
                planAnchor: period === "someday" ? null : periodAnchor(period, text(item.dueDate)),
                plannedDate: null,
              }));
            if (await act("batch-add", { listName: selected.title, items: chosen })) setSaved(true);
          }}
        >
          <h2 className={s.heading}>{selected.title}</h2>
          <p className={s.caption}>{selected.description}</p>
          {selected.id === "occasion" && (
            <FormField label="기념일·여행 기준 날짜" className={s.field}>
              <DateField
                required
                value={base}
                onChange={(e) => {
                  setBase(e.target.value);
                  if (e.target.value) setItems(templateItems(selected, e.target.value));
                  setSaved(false);
                }}
              />
            </FormField>
          )}
          <table className={s.table}>
            <thead>
              <tr>
                <th>추가할 할 일</th>
                <th>반복</th>
                <th>첫 날짜</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${selected.id}-${index}`}>
                  <td>
                    <Checkbox
                      checked={checked.includes(index)}
                      onChange={(e) => {
                        setChecked((old) =>
                          e.target.checked ? [...old, index] : old.filter((i) => i !== index),
                        );
                        setSaved(false);
                      }}
                    >
                      {text(item.title)}
                    </Checkbox>
                  </td>
                  <td>
                    <Select
                      aria-label={`${text(item.title)} 반복`}
                      value={item.repeatRule ? "suggested" : "none"}
                      onChange={(e) =>
                        patch(index, {
                          repeatRule:
                            e.target.value === "none" ? null : selected.items[index].repeatRule,
                        })
                      }
                    >
                      {selected.items[index].repeatRule && (
                        <option value="suggested">
                          {repeatLabel({ repeatRule: selected.items[index].repeatRule })}
                        </option>
                      )}
                      <option value="none">없음</option>
                    </Select>
                  </td>
                  <td>
                    <DateField
                      required
                      aria-label={`${text(item.title)} 첫 날짜`}
                      value={text(item.dueDate)}
                      onChange={(e) => patch(index, { dueDate: e.target.value })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s.actions}>
            <span className={s.caption}>목록 · {selected.title}</span>
            <FormField label="계획 기간" className={s.field}>
              <Select
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setSaved(false);
                }}
              >
                {PERIODS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className={s.actions}>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || checked.length === 0 || saved}
            >
              {saved ? "추가했어요" : `선택한 ${checked.length}개 추가`}
            </Button>
            <span className={s.caption}>
              {saved ? "기간 계획에서 확인할 수 있어요." : "반복·날짜는 추가 전에 바꿀 수 있어요."}
            </span>
          </div>
          {saved && (
            <p role="status" className={s.caption}>
              새 할 일을 저장했어요. 기존 항목은 그대로입니다.
            </p>
          )}
        </form>
      </div>
    </fieldset>
  );
}
