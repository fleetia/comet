import { useState, type JSX } from "react";
import { Button, Select } from "@comet/ui";
import { PlayIcon } from "@comet/icon";
import type { AnimationAsset, CharacterDefinition, InstalledCharacter } from "../../types";
import { useAnimationFrames } from "../../hooks/useAnimationFrames";
import { useAnimationPlayer } from "../../hooks/useAnimationPlayer";
import { animationAssetUrl } from "../characterAnimation";
import { AnimationFrameView } from "../AnimationFrameView/AnimationFrameView";
import { spriteSource } from "../characterIdentity";
import type { AssetSelection } from "./AppearanceEditor";
import * as styles from "./appearance.css";

export function AppearancePreview({
  definition,
  character,
  assets,
  selection,
  onSelect,
  visible,
}: {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  assets: AnimationAsset[];
  selection: AssetSelection;
  onSelect: (selection: AssetSelection) => void;
  visible: boolean;
}): JSX.Element {
  const [playVersion, setPlayVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const expression = selection.type === "expression" ? selection.id : "평온";
  const clip =
    selection.type === "motion"
      ? definition.animation?.clips.find((value) => value.id === selection.id)
      : undefined;
  const source = spriteSource(character, expression);
  const sources = Object.fromEntries([
    ...Object.keys(character?.animationAssets ?? {}).map((id) => [
      id,
      animationAssetUrl(character!.id, id),
    ]),
    ...assets.map((asset) => [asset.assetId, `data:${asset.mime};base64,${asset.data}`]),
  ]);
  const frames = useAnimationFrames(visible ? clip : undefined, sources, 140);
  const player = useAnimationPlayer({
    clip,
    binding: { repeat: true, intervalMs: 0 },
    runKey: `${clip?.id}:${playVersion}`,
    enabled: playing && visible,
    ready: frames.ready,
  });
  return (
    <div className={styles.previewCard}>
      <div className={styles.previewHeading}>
        <h2 className={styles.sectionTitle}>미리 보기</h2>
        <Select
          aria-label="미리보기 표정"
          value={expression}
          onChange={(event) => onSelect({ type: "expression", id: event.target.value })}
        >
          {Object.keys(definition.expressions).map((key) => (
            <option key={key}>{key}</option>
          ))}
        </Select>
      </div>
      <div className={styles.previewStage} aria-label={`${expression} 이미지`}>
        {clip && playing && player.frameIndex !== null ? (
          <AnimationFrameView
            frames={frames.frames}
            index={player.frameIndex}
            size={140}
            label="동작 미리보기"
          />
        ) : source ? (
          <img src={source} alt={`${expression} 표정 이미지`} className={styles.previewImage} />
        ) : (
          <span>{definition.expressions[expression]}</span>
        )}
        {!character?.sprites[expression] && (
          <span className={styles.caption}>
            {character?.sprites["평온"]
              ? "이 표정의 이미지가 없어 평온 이미지로 표시해요."
              : "텍스트 표정으로 표시해요."}
          </span>
        )}
      </div>
      <p className={styles.caption}>지금 보이는 것</p>
      <p className={styles.previewDescription}>
        {expression} 표정{clip ? ` · ${clip.name}` : ""}
      </p>
      {clip && (
        <Button
          size="small"
          leadingIcon={<PlayIcon size={13} />}
          onClick={() => {
            setPlayVersion((value) => value + 1);
            setPlaying((value) => !value);
          }}
          disabled={!frames.ready}
        >
          {playing ? "정지" : "동작 재생"}
        </Button>
      )}
      {frames.error && (
        <p className={styles.caption} role="alert">
          {frames.error}
        </p>
      )}
    </div>
  );
}
