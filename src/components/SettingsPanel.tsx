import { useState, type JSX } from "react";
import {
  Button,
  Checkbox,
  FormField,
  Rule,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "@fleetia/lagrange";
import type { Snapshot } from "../types";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { MemorySettings } from "./MemorySettings";
import { ModelSettings } from "./ModelSettings";
import { WordbookPanel } from "./WordbookPanel";
import { WindowHeader } from "./WindowHeader";
import * as s from "../lagrange.css";
import * as d from "../desktop.css";

type Props = { snapshot: Snapshot; preview?: boolean };
export function SettingsPanel({ snapshot, preview = false }: Props): JSX.Element {
  const [section, setSection] = useState("general");
  const draft = useSettingsDraft(snapshot.settings);
  const { settings, pending, error, notice, hasChanges, validInterval, change, run, reset } = draft;
  const isSettingsSection = section === "general" || section === "model";
  const Container = preview ? "section" : "main";
  return (
    <Container className={`${s.settings} ${preview ? s.previewSettings : ""}`}>
      <WindowHeader className={d.pageHeader} label="설정 닫기" preview={preview}>
        <div>
          <p className={s.eyebrow}>comet</p>
          <h1 className={s.settingsTitle}>설정</h1>
          <p className={s.quiet}>함께 지내는 방식과 나만의 대사를 정해요.</p>
        </div>
      </WindowHeader>
      <Tabs value={section} onValueChange={setSection} className={d.tabs}>
        <TabList aria-label="설정 항목" className={d.tabList}>
          <Tab value="general">기본 동작</Tab>
          <Tab value="model">대화 모델</Tab>
          <Tab value="wordbook">개인 단어장</Tab>
          <Tab value="memory">기억</Tab>
        </TabList>
        <TabPanel value="general" className={d.tabPanel}>
          <p className={d.info}>
            모델을 설치하지 않아도 인사와 자동 잡담, 등록한 대사를 사용할 수 있어요.
          </p>
          <fieldset className={d.fieldset} disabled={!!pending}>
            <legend className={s.sectionTitle}>먼저 이야기하기</legend>
            <Checkbox
              className={s.row}
              checked={settings.autonomousEnabled}
              onChange={(event) => change("autonomousEnabled", event.target.checked)}
            >
              바탕화면에서 먼저 이야기하기
            </Checkbox>
            <p className={s.quiet}>
              끄면 먼저 시작하는 대화를 멈춰요. 직접 말을 거는 것은 그대로 사용할 수 있어요.
            </p>
            <div className={d.subsettings}>
              <FormField
                className={s.field}
                label="이야기 간격"
                description="1~60분. 실제 간격은 조금씩 달라져요."
              >
                <TextField
                  className={d.shortInput}
                  type="number"
                  min={1}
                  max={60}
                  value={settings.idleMinutes}
                  onChange={(event) => change("idleMinutes", Number(event.target.value))}
                />
              </FormField>
              <Checkbox
                className={s.row}
                disabled={!settings.autonomousEnabled}
                checked={settings.localIdleEnabled}
                onChange={(event) => change("localIdleEnabled", event.target.checked)}
              >
                로컬 모델로 새 잡담 만들기
              </Checkbox>
              <Checkbox
                className={s.row}
                disabled={!settings.autonomousEnabled}
                checked={settings.apiIdleEnabled}
                onChange={(event) => change("apiIdleEnabled", event.target.checked)}
              >
                API로 새 잡담 만들기
              </Checkbox>
              <p className={s.quiet}>
                선택한 대화 방식이 준비되면 사용해요. API 잡담은 기본으로 꺼져 있으며, 켜면 자동
                요청과 비용이 발생할 수 있어요.
              </p>
            </div>
          </fieldset>
          {snapshot.runtime.paused && (
            <div className={s.section}>
              <p className={s.quiet}>
                지금은 자동 잡담을 잠시 쉬고 있어요. 저장한 설정과 별도로 일시정지된 상태예요.
              </p>
              <Button
                variant="secondary"
                disabled={!!pending}
                onClick={() => void run("set_paused", { paused: false })}
              >
                자동 잡담 다시 시작
              </Button>
            </div>
          )}
          <details className={d.disclosure}>
            <summary className={d.disclosureSummary}>표시와 종료</summary>
            <p className={s.quiet}>상자를 숨겨도 메뉴 막대에서 다시 열 수 있어요.</p>
            <div className={s.row}>
              <Button
                variant="secondary"
                disabled={!!pending}
                onClick={() => void run("hide_boxes")}
              >
                상자 숨기기
              </Button>
              <Button variant="quiet" disabled={!!pending} onClick={() => void run("quit_app")}>
                앱 종료
              </Button>
            </div>
          </details>
        </TabPanel>
        <TabPanel value="model" className={d.tabPanel}>
          <ModelSettings snapshot={snapshot} draft={draft} />
        </TabPanel>
        <TabPanel value="wordbook" className={d.tabPanel}>
          <WordbookPanel
            entries={snapshot.wordbook}
            title="개인 단어장"
            description="캐릭터를 바꿔도 A/B 자리에 적용되는 나만의 대사예요. 키워드가 포함되면 모델 없이 그대로 재생해요."
          />
        </TabPanel>
        <TabPanel value="memory" className={d.tabPanel}>
          <MemorySettings memories={snapshot.memories} />
        </TabPanel>
      </Tabs>
      {isSettingsSection ? (
        <footer className={d.saveBar}>
          <Rule variant="structural" />
          <div className={d.saveActions}>
            <Button
              variant="primary"
              disabled={!!pending || !hasChanges || !validInterval}
              onClick={() => void run("save_settings")}
            >
              {pending === "save_settings" ? "저장 중…" : "설정 저장"}
            </Button>
            {hasChanges && (
              <Button variant="quiet" disabled={!!pending} onClick={reset}>
                변경 취소
              </Button>
            )}
            <span className={d.saveStatus} role="status">
              {hasChanges ? "기본 동작·대화 모델의 변경을 함께 저장해요." : "저장된 설정이에요."}
            </span>
          </div>
          {!validInterval && (
            <p className={s.error} role="alert">
              기본 동작에서 이야기 간격을 1~60분으로 입력해 주세요.
            </p>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className={s.success} role="status">
              {notice}
            </p>
          )}
        </footer>
      ) : hasChanges ? (
        <p className={s.quiet}>
          기본 동작·대화 모델에 저장하지 않은 변경이 있어요. 해당 탭에서 저장할 수 있어요.
        </p>
      ) : null}
    </Container>
  );
}
