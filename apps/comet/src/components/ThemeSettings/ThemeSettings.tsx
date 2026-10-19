import type { JSX } from "react";
import { ChatIcon, PaletteIcon, PlusIcon } from "@comet/icon";
import {
  ChoiceTile,
  FormField,
  SegmentedControl,
  SettingsSummary,
  SkinScene,
  Slider,
} from "@comet/ui";
import type { Theme } from "@comet/token";
import type { Appearance, ColorMode, CustomSkin, Snapshot } from "../../types";
import {
  appearanceVars,
  customSkinVars,
  customSkinWarnings,
  DEFAULT_CUSTOM_SKIN,
  locksColorMode,
  resolveTheme,
} from "../../appearance";
import { skinBase } from "@comet/token/skin";
import { updateAppearance, useAppearance, useSystemDark } from "../../hooks/useAppearance";
import { followsTheme } from "../balloonTypography";
import { ColorField } from "../../widgets/WidgetAppearance/ColorField";
import { error as errorStyle } from "../../common.css";
import * as settings from "../SettingsPanel/figmaSettings.css";
import * as s from "./themeSettings.css";

type Props = {
  snapshot: Snapshot;
  onOpenBalloon: (characterId: string) => void;
};

const MODES: { value: ColorMode; label: string }[] = [
  { value: "system", label: "시스템 따라" },
  { value: "dark", label: "다크" },
  { value: "light", label: "라이트" },
];
const CUSTOM_FIELDS: { key: keyof CustomSkin; label: string }[] = [
  { key: "background", label: "배경" },
  { key: "balloon", label: "말풍선" },
  { key: "widget", label: "위젯" },
  { key: "accent", label: "강조" },
];
const WARNINGS = {
  text: "글자가 말풍선이나 위젯 위에서 잘 안 보일 수 있어요. 밝기 차이를 더 크게 해 보세요.",
  accent: "강조색이 배경·말풍선과 비슷해서 선택한 항목이 잘 드러나지 않아요.",
};

export const SKIN_NAMES: Record<Appearance["skin"], string> = {
  night: "밤하늘",
  paper: "따뜻한 종이",
  play: "놀이",
  custom: "내 스킨",
};

/** One line for the general settings row and the friend balloon page. */
export function appearanceSummary(appearance: Appearance): string {
  if (locksColorMode(appearance)) return SKIN_NAMES[appearance.skin];
  const mode = { system: "화면 모드는 시스템을 따라요", dark: "다크", light: "라이트" };
  return `${SKIN_NAMES[appearance.skin]} · ${mode[appearance.colorMode]}`;
}

function modeCaption(appearance: Appearance, theme: Theme): string {
  if (locksColorMode(appearance)) return "이 스킨은 한 가지 모습뿐이라 화면 모드를 따로 고르지 않아요.";
  if (appearance.colorMode === "system") {
    return `시스템 설정에 맞춰 다크와 라이트가 바뀌어요. 지금은 ${theme === "dark" ? "다크" : "라이트"}예요.`;
  }
  return appearance.colorMode === "dark" ? "항상 다크로 보여요." : "항상 라이트로 보여요.";
}

export function ThemeSettings({ snapshot, onOpenBalloon }: Props): JSX.Element {
  const { appearance, error } = useAppearance();
  const systemDark = useSystemDark();
  const theme = resolveTheme(appearance, systemDark);
  const locked = locksColorMode(appearance);
  const custom = appearance.customSkin;
  const friends = snapshot.characters.active
    .map((id) => snapshot.characters.installed.find((character) => character.id === id))
    .filter((character) => character !== undefined);
  function change(patch: Partial<Appearance>): void {
    updateAppearance({ ...appearance, ...patch });
  }
  function changeCustom(patch: Partial<CustomSkin>): void {
    change({ skin: "custom", customSkin: { ...(custom ?? DEFAULT_CUSTOM_SKIN), ...patch } });
  }
  return (
    <div className={settings.split}>
      <section className={settings.inspector} aria-labelledby="theme-settings-title">
        <h2 id="theme-settings-title" className={settings.inspectorTitle}>
          <span className={settings.icon}>
            <PaletteIcon size={20} />
          </span>
          테마
        </h2>
        <p className={s.label}>지금 모습</p>
        <SkinScene
          theme={theme}
          size="large"
          style={appearanceVars(appearance, theme, "app")}
          line="오늘 하늘 색 마음에 들어?"
          meta="3:24  D+42"
        />
        <div className={settings.controls}>
          <span className={settings.copy}>화면 모드</span>
          <SegmentedControl
            label="화면 모드"
            appearance="contained"
            options={MODES}
            value={appearance.colorMode}
            disabled={locked}
            onValueChange={(value) => change({ colorMode: value as ColorMode })}
          />
        </div>
        <p className={settings.caption}>{modeCaption(appearance, theme)}</p>
      </section>
      <div className={settings.right}>
        <section className={settings.section} aria-labelledby="theme-skin-title">
          <h3 id="theme-skin-title" className={settings.sectionTitle}>
            스킨 <span className={s.titleNote}>바탕화면, 말풍선, 위젯, 설정 창에 같이 입혀져요</span>
          </h3>
          <div className={s.skinGrid}>
            <ChoiceTile
              kind="theme"
              className={s.tile}
              label={SKIN_NAMES.night}
              description="기본 · 다크는 밤하늘, 라이트는 새벽 유리"
              selected={appearance.skin === "night"}
              onClick={() => change({ skin: "night" })}
              graphic={
                <span className={s.pair}>
                  <SkinScene theme="dark" />
                  <SkinScene theme="light" />
                </span>
              }
            />
            <ChoiceTile
              kind="theme"
              className={s.tile}
              label={SKIN_NAMES.paper}
              description="종이 질감과 차분한 글씨"
              selected={appearance.skin === "paper"}
              onClick={() => change({ skin: "paper" })}
              graphic={<SkinScene theme="paper" />}
            />
            <ChoiceTile
              kind="theme"
              className={s.tile}
              label={SKIN_NAMES.play}
              description="선명한 색과 굵은 테두리"
              selected={appearance.skin === "play"}
              onClick={() => change({ skin: "play" })}
              graphic={<SkinScene theme="play" />}
            />
            {custom ? (
              <ChoiceTile
                kind="theme"
                className={s.tile}
                label={SKIN_NAMES.custom}
                description="배경·말풍선·위젯 색을 직접 골라요"
                selected={appearance.skin === "custom"}
                onClick={() => change({ skin: "custom" })}
                graphic={<SkinScene theme={skinBase(custom)} style={customSkinVars(custom)} />}
              />
            ) : (
              <ChoiceTile
                kind="theme-add"
                className={s.tile}
                label={SKIN_NAMES.custom}
                description="배경·말풍선·위젯 색을 직접 골라요"
                onClick={() => changeCustom({})}
                graphic={<PlusIcon size={18} />}
              />
            )}
          </div>
        </section>
        {appearance.skin === "custom" && custom && (
          <section className={settings.section} aria-labelledby="theme-custom-title">
            <h3 id="theme-custom-title" className={settings.sectionTitle}>
              내 스킨 색
            </h3>
            <div className={s.customFields}>
              {CUSTOM_FIELDS.map(({ key, label }) => (
                <FormField key={key} label={label}>
                  <ColorField
                    swatchLabel={`${label} 색 선택`}
                    value={custom[key]}
                    onValueChange={(value) => changeCustom({ [key]: value })}
                  />
                </FormField>
              ))}
            </div>
            <p className={settings.caption}>
              글자·테두리·선택 색은 고른 색에 맞춰 읽기 쉽게 정해요.
            </p>
            {customSkinWarnings(custom).map((warning) => (
              <p key={warning} role="status" className={s.warning}>
                {WARNINGS[warning]}
              </p>
            ))}
          </section>
        )}
        <section className={settings.section} aria-labelledby="theme-opacity-title">
          <h3 id="theme-opacity-title" className={settings.sectionTitle}>
            바탕화면 투명도
          </h3>
          <div className={settings.group}>
            {(
              [
                ["balloonOpacity", "말풍선"],
                ["widgetOpacity", "위젯"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={s.opacityRow}>
                <span className={settings.copy}>{label}</span>
                <Slider
                  aria-label={`${label} 불투명도`}
                  min={20}
                  max={100}
                  step={5}
                  value={appearance[key]}
                  onChange={(event) => change({ [key]: event.currentTarget.valueAsNumber })}
                />
                <span className={s.opacityValue} aria-hidden="true">
                  {appearance[key] === 100 ? "불투명" : `${appearance[key]}%`}
                </span>
              </label>
            ))}
          </div>
          <p className={settings.caption}>설정 창과 다이어리는 항상 불투명해요.</p>
        </section>
        {friends.length > 0 && (
          <section className={settings.section} aria-labelledby="theme-friends-title">
            <h3 id="theme-friends-title" className={settings.sectionTitle}>
              친구별 말풍선
            </h3>
            <div className={s.friendList}>
              {friends.map((character) => (
                <SettingsSummary
                  key={character.id}
                  className={s.friend}
                  title={`${character.definition.name} 말풍선`}
                  description={followsTheme(character) ? "전체 테마를 따라요" : "따로 꾸몄어요"}
                  leading={
                    <span className={settings.icon}>
                      <ChatIcon size={18} />
                    </span>
                  }
                  onClick={() => onOpenBalloon(character.id)}
                />
              ))}
            </div>
            <p className={settings.caption}>
              친구 말풍선에서 글자 색이나 배경을 바꾸면 그 친구만 따로 꾸며요. 나머지는 스킨을
              따라가요.
            </p>
          </section>
        )}
        {error && (
          <p role="alert" className={errorStyle}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
