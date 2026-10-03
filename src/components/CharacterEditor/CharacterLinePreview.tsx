import { useMemo, useState, type JSX } from "react";
import { Button, Surface } from "@fleetia/lagrange";
import type {
  AnimationAsset,
  CharacterDefinition,
  CharacterLine,
  InstalledCharacter,
} from "../../types";
import { useAnimationFrames } from "../../hooks/useAnimationFrames";
import { useAnimationPlayer } from "../../hooks/useAnimationPlayer";
import { useTypewriter } from "../../hooks/useTypewriter";
import { AnimationFrameView } from "../AnimationFrameView/AnimationFrameView";
import { animationAssetUrl, animationBinding } from "../characterAnimation";
import { spriteSource } from "../characterIdentity";
import { balloonTextStyle, DEFAULT_BALLOON_STYLE } from "../balloonTypography";
import { CharacterWorkPanel } from "./CharacterWorkPanel";
import * as common from "../characters.css";
import * as s from "./CharacterEditor.css";

export function CharacterLinePreview({
  definition,
  character,
  line,
  assets,
  visible,
}: {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  line: CharacterLine | undefined;
  assets: AnimationAsset[];
  visible: boolean;
}): JSX.Element {
  const [playing, setPlaying] = useState(false);
  const [version, setVersion] = useState(0);
  const expression = line?.expression ?? "평온";
  const animation = definition.animation;
  const binding =
    line?.motion?.mode === "static"
      ? undefined
      : line?.motion?.mode === "clip"
        ? line.motion
        : (animationBinding(animation, expression, "speaking") ?? undefined);
  const clip = animation?.clips.find((item) => item.id === binding?.clipId);
  const sources = useMemo(
    () =>
      Object.fromEntries(
        (clip?.frames ?? []).map(({ assetId }) => {
          const pending = assets.find((asset) => asset.assetId === assetId);
          return [
            assetId,
            pending
              ? `data:${pending.mime};base64,${pending.data}`
              : character
                ? animationAssetUrl(character.id, assetId)
                : "",
          ];
        }),
      ),
    [clip?.frames, assets, character?.id],
  );
  const loaded = useAnimationFrames(visible ? clip : undefined, sources, 128);
  const player = useAnimationPlayer({
    clip,
    binding,
    runKey: `${version}:${line?.text ?? ""}`,
    enabled: playing && visible,
    ready: loaded.ready,
  });
  const style = definition.balloonStyle ?? DEFAULT_BALLOON_STYLE;
  const text = useTypewriter(
    `${version}:${line?.text ?? ""}`,
    line?.text ?? "",
    playing && visible ? (style.textSpeed ?? 0) : 0,
    visible,
  );
  const image = spriteSource(character, expression);
  return (
    <CharacterWorkPanel className={s.authoredPreview} aria-label="선택한 대사 미리보기">
      <h3 className={common.subheading}>선택한 대사 미리보기</h3>
      <Surface tone="accent" className={s.previewStage}>
        {playing && player.frameIndex !== null && loaded.frames?.[player.frameIndex] ? (
          <AnimationFrameView
            frames={loaded.frames}
            index={player.frameIndex}
            size={128}
            label="대사 동작 미리보기"
          />
        ) : image ? (
          <img className={s.expressionImage} src={image} alt="선택한 대사 표정" />
        ) : (
          <span>{definition.expressions[expression]}</span>
        )}
        <strong>{definition.name}</strong>
      </Surface>
      <Surface tone="inset" className={s.speechPreview} style={balloonTextStyle(style)}>
        {text || "대사를 선택해 주세요."}
      </Surface>
      <div className={common.compactActions}>
        <Button
          variant="primary"
          disabled={!line?.text.trim()}
          onClick={() => {
            setVersion((value) => value + 1);
            setPlaying(true);
          }}
        >
          미리보기
        </Button>
        <Button variant="quiet" disabled={!playing} onClick={() => setPlaying(false)}>
          정지
        </Button>
        <span className={common.small}>원문 재생</span>
      </div>
      {loaded.error && (
        <p role="alert" className={common.small}>
          {loaded.error}
        </p>
      )}
    </CharacterWorkPanel>
  );
}
