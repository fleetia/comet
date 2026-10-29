import { useId, useState, type JSX, type ReactNode } from "react";
import {
  Button,
  FormField,
  SettingControlRow,
  SettingsSummary,
  Surface,
  Switch,
  Textarea,
  TextInput,
} from "@comet/ui";
import { PaletteIcon } from "@comet/icon";
import { BALLOON_SPRITE, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import {
  balloonTextStyle,
  DEFAULT_BALLOON_STYLE,
  followsTheme,
  themedBalloonStyle,
} from "../balloonTypography";
import { appearanceSummary } from "../ThemeSettings/ThemeSettings";
import { useAppearance } from "../../hooks/useAppearance";
import { useTypewriter } from "../../hooks/useTypewriter";
import type { CharacterDefinition } from "../../types";
import type { CharacterEditorProps } from "./CharacterEditor.types";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

/** The friend's link to the app-wide skin: follow it again, or open the theme page. */
function BalloonTheme({
  definition,
  character,
  onChange,
  onSprite,
  onOpenTheme,
}: Pick<CharacterEditorProps, "definition" | "character" | "onSprite" | "onOpenTheme"> & {
  onChange: (patch: Pick<CharacterDefinition, "balloonStyle">) => void;
}): JSX.Element {
  const { appearance } = useAppearance();
  const following = followsTheme({ definition, sprites: character?.sprites ?? {} });
  const hasImage = Boolean(character?.sprites[BALLOON_SPRITE]);
  return (
    <section className={e.balloonTheme} aria-label="말풍선 테마">
      <h3 className={s.subheading}>테마</h3>
      <SettingControlRow
        className={e.formControlRow}
        title="전체 테마 따르기"
        description={
          following
            ? `지금 전체 테마: ${appearanceSummary(appearance)}`
            : hasImage
              ? "켜면 바꾼 글자 크기·글꼴·색을 비우고 말풍선 이미지를 지워요"
              : "켜면 바꾼 글자 크기·글꼴·색을 비워요"
        }
        control={
          <Switch
            aria-label="전체 테마 따르기"
            checked={following}
            disabled={following}
            onChange={() => {
              onChange({ balloonStyle: themedBalloonStyle(definition.balloonStyle) });
              if (hasImage) onSprite?.(BALLOON_SPRITE, true);
            }}
          />
        }
      />
      {onOpenTheme && (
        <SettingsSummary
          className={e.formControlRow}
          title="전체 테마 바꾸기"
          description="스킨과 화면 모드는 설정 › 일반 › 테마에서 정해요"
          leading={<PaletteIcon size={18} />}
          onClick={onOpenTheme}
        />
      )}
    </section>
  );
}

export function BalloonAppearance({
  definition,
  character,
  onChange,
  onSprite,
  footer,
  visible,
  onOpenTheme,
}: Pick<CharacterEditorProps, "definition" | "character" | "onSprite" | "onOpenTheme"> & {
  onChange: (patch: Pick<CharacterDefinition, "balloonStyle">) => void;
  footer: ReactNode;
  visible: boolean;
}): JSX.Element {
  const fontOptionsId = useId();
  const skin = spriteUrl(character, BALLOON_SPRITE);
  const { slice } = useImageSlice(skin);
  const skinned = skin && slice ? skinStyle(skin, slice) : undefined;
  const balloonStyle = {
    ...(definition.balloonStyle ?? DEFAULT_BALLOON_STYLE),
    textSpeed: definition.balloonStyle?.textSpeed ?? 0,
  };
  const [samples, setSamples] = useState<Record<string, { short: string; long: string }>>({});
  const id = character?.id ?? "new";
  const sample = samples[id] ?? {
    short: definition.greeting[0]?.text ?? "",
    long: definition.idleLines.map((line) => line.text).join("\n"),
  };
  const [playing, setPlaying] = useState(false);
  const [version, setVersion] = useState(0);
  const shown = useTypewriter(
    `${version}:${id}`,
    sample.short,
    playing && visible ? balloonStyle.textSpeed : 0,
    visible,
  );
  return (
    <section aria-label="말풍선 설정" className={e.balloonLayout}>
      <CharacterWorkPanel footer={footer}>
        <BalloonTheme
          definition={definition}
          character={character}
          onChange={onChange}
          onSprite={onSprite}
          onOpenTheme={onOpenTheme}
        />
        <h3 className={s.subheading}>글자 표시</h3>
        <div className={e.balloonFontFields}>
          <FormField label="글자 크기 · 12~40px">
            <TextInput
              fill
              type="number"
              min={12}
              max={40}
              step={1}
              aria-label="말풍선 글자 크기(px)"
              value={balloonStyle.fontSize}
              onChange={(event) =>
                onChange({
                  balloonStyle: { ...balloonStyle, fontSize: Number(event.target.value) },
                })
              }
            />
          </FormField>
          <FormField label="글자 색상">
            <div className={s.compactActions}>
              <TextInput
                fill
                className={s.balloonColorInput}
                type="color"
                aria-label="말풍선 글자 색"
                value={balloonStyle.textColor ?? "#302a33"}
                onChange={(event) =>
                  onChange({ balloonStyle: { ...balloonStyle, textColor: event.target.value } })
                }
              />
              <Button
                variant="ghost"
                disabled={balloonStyle.textColor === null}
                onClick={() => onChange({ balloonStyle: { ...balloonStyle, textColor: null } })}
              >
                기본색
              </Button>
            </div>
          </FormField>
          <FormField label="설치된 폰트 이름">
            <TextInput
              fill
              aria-label="말풍선 폰트"
              list={fontOptionsId}
              maxLength={100}
              placeholder="기본 글꼴"
              value={balloonStyle.fontFamily}
              onChange={(event) =>
                onChange({ balloonStyle: { ...balloonStyle, fontFamily: event.target.value } })
              }
            />
          </FormField>
        </div>
        <datalist id={fontOptionsId}>
          {["Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Arial", "Georgia"].map(
            (font) => (
              <option key={font} value={font} />
            ),
          )}
        </datalist>
        <SettingControlRow
          className={e.formControlRow}
          title="글자 출력 속도"
          description="초당 1~100글자, 0이면 대사를 즉시 표시해요."
          control={
            <TextInput
              fill
              type="number"
              min={0}
              max={100}
              step={1}
              aria-label="글자 출력 속도 (초당 글자 수)"
              value={balloonStyle.textSpeed}
              onChange={(event) =>
                onChange({
                  balloonStyle: { ...balloonStyle, textSpeed: Number(event.target.value) },
                })
              }
            />
          }
        />
        <p className={s.small}>폰트를 비워 두거나 설치된 이름이 아니면 기본 글꼴로 표시해요.</p>
        <section className={e.sectionBoundary}>
          <div className={e.authoredHeading}>
            <h3 className={s.subheading}>말풍선 이미지</h3>
            <span className={s.small}>선택·제거 즉시 반영</span>
          </div>
          <Surface variant="card" className={e.cardCompact}>
            <span className={s.spriteFrame} aria-label="말풍선 이미지">
              {skin ? <img className={s.spriteImage} src={skin} alt="말풍선 이미지" /> : "기본"}
            </span>
            <div className={s.compactActions}>
              <Button
                variant="primary"
                disabled={!character || !onSprite}
                onClick={() => onSprite?.(BALLOON_SPRITE, false)}
              >
                말풍선 이미지 선택
              </Button>
              {character?.sprites[BALLOON_SPRITE] && (
                <Button variant="ghost" onClick={() => onSprite?.(BALLOON_SPRITE, true)}>
                  말풍선 이미지 제거
                </Button>
              )}
            </div>
            <p className={s.small}>SVG·PNG·GIF·WebP·JPEG · 최대 2 MiB</p>
          </Surface>
          <p className={s.small}>가운데 1px 행·열을 늘리고 모서리 모양은 유지해요.</p>
        </section>
        <section className={e.sectionBoundary}>
          <h3 className={s.subheading}>미리보기 문장</h3>
          {(["short", "long"] as const).map((key) => (
            <FormField
              className={e.balloonSample}
              key={key}
              label={key === "short" ? "짧은 대사" : "긴 대사"}
            >
              <Textarea
                layout="flexible"
                fill
                rows={3}
                className={s.personalityInput}
                value={sample[key]}
                maxLength={500}
                onChange={(event) =>
                  setSamples((previous) => ({
                    ...previous,
                    [id]: { ...sample, [key]: event.target.value },
                  }))
                }
              />
            </FormField>
          ))}
        </section>
      </CharacterWorkPanel>
      <CharacterWorkPanel aria-label="말풍선 표시 미리보기">
        <div className={e.authoredHeading}>
          <h3 className={s.subheading}>말풍선 미리보기</h3>
          <Button
            variant="ghost"
            onClick={() => {
              setVersion((value) => value + 1);
              setPlaying(true);
            }}
          >
            출력 시험
          </Button>
        </div>
        <Surface variant="accent" className={e.balloonStage}>
          <div className={e.balloonSpecimen} style={skinned}>
            <strong>{definition.name || "새 캐릭터"}</strong>
            <p
              className={s.balloonTextPreview}
              aria-label="말풍선 글자 미리보기"
              style={balloonTextStyle(balloonStyle)}
            >
              {shown}
            </p>
          </div>
          <div className={e.balloonSpecimen} style={skinned}>
            <p className={s.balloonTextPreview} style={balloonTextStyle(balloonStyle)}>
              {sample.long}
            </p>
          </div>
        </Surface>
        <p className={s.small}>선택지 스토리는 바로 표시해요.</p>
      </CharacterWorkPanel>
    </section>
  );
}
