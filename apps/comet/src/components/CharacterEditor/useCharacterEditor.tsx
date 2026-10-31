import { useEffect, useId, useState, type Dispatch, type JSX, type SetStateAction } from "react";
import { Button } from "@comet/ui";
import { ActionBar } from "../../primitives";
import type {
  AnimationAsset,
  CharacterDefinition,
  CharacterNpc,
  InstalledCharacter,
} from "../../types";
import type { AssetSelection } from "./AppearanceEditor";
import type { CharacterEditorProps, DialogueType } from "./CharacterEditor.types";
import { getCharacterEditorValues } from "./characterEditorValues";
import * as s from "../characters.css";

type PreviewSelection = {
  group: "greeting" | "idleLines" | "departureLines" | "returnLines";
  index: number;
};

export type CharacterEditorState = ReturnType<typeof getCharacterEditorValues> &
  Pick<
    CharacterEditorProps,
    | "definition"
    | "character"
    | "pending"
    | "presentIds"
    | "packDefinition"
    | "packBaseline"
    | "children"
  > & {
    installed: InstalledCharacter[];
    trialAssets: Record<string, AnimationAsset[]>;
    animationAssets: AnimationAsset[];
    animationVersion: number;
    isTogether: boolean;
    canEditCombination: boolean;
    reactionTarget: string | null;
    previewSelection: PreviewSelection;
    setPreviewSelection: Dispatch<SetStateAction<PreviewSelection>>;
    assetSelections: Record<string, AssetSelection>;
    setAssetSelections: Dispatch<SetStateAction<Record<string, AssetSelection>>>;
    npcPreviewIndex: number;
    setNpcPreviewIndex: Dispatch<SetStateAction<number>>;
    dialogueType: DialogueType;
    chooseDialogueType: (type: DialogueType) => void;
    tab: string;
    navigate: (next: string) => void;
    tabsId: string;
    change: <K extends keyof CharacterDefinition>(key: K, value: CharacterDefinition[K]) => void;
    changeNpc: (patch: Partial<CharacterNpc>) => void;
    definitionActions: JSX.Element;
  };

export function useCharacterEditor({
  definition,
  character,
  installed = [],
  presentIds,
  packDefinition,
  packBaseline,
  trialAssets = {},
  onChange,
  onSave,
  onCancel,
  onNavigate,
  animationAssets = [],
  animationVersion = 0,
  pending,
  dirty,
  children,
  memoryTabRequest = 0,
  tabRequest,
  isTogether = false,
  dialogueType: controlledDialogueType,
  onDialogueTypeChange,
  canEditCombination = true,
}: CharacterEditorProps): CharacterEditorState {
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection>({
    group: "greeting",
    index: 0,
  });
  const [assetSelections, setAssetSelections] = useState<Record<string, AssetSelection>>({});
  const [localDialogueType, setLocalDialogueType] = useState<DialogueType>("lines");
  const [npcPreviewIndex, setNpcPreviewIndex] = useState(0);
  const dialogueType = controlledDialogueType ?? localDialogueType;
  function chooseDialogueType(type: DialogueType): void {
    if (type === dialogueType) return;
    onNavigate?.();
    setLocalDialogueType(type);
    onDialogueTypeChange?.(type);
  }
  const [tab, setTab] = useState(
    memoryTabRequest > 0 ? "memory" : character ? "overview" : "profile",
  );
  const tabsId = useId();
  function navigate(next: string): void {
    if (next === tab) return;
    onNavigate?.();
    setReactionTarget(null);
    setTab(next);
  }
  useEffect(() => {
    setTab(memoryTabRequest > 0 ? "memory" : character ? "overview" : "profile");
  }, [character?.id]);
  useEffect(() => {
    if (memoryTabRequest > 0) navigate("memory");
  }, [memoryTabRequest]);
  useEffect(() => {
    if (!tabRequest?.tab || tabRequest.id !== character?.id) return;
    navigate(tabRequest.tab);
    const target = tabRequest.relationshipTarget;
    setReactionTarget(target ?? null);
  }, [tabRequest?.revision, character?.id]);
  function change<K extends keyof CharacterDefinition>(
    key: K,
    value: CharacterDefinition[K],
  ): void {
    onChange({ ...definition, [key]: value });
  }
  function changeNpc(patch: Partial<CharacterNpc>): void {
    change("npc", {
      inviteKeywords: [],
      appearanceKeywords: [],
      requiredFlags: [],
      entryLines: [],
      exitPolicy: "topicChange",
      ...definition.npc,
      ...patch,
    });
  }
  const values = getCharacterEditorValues({
    definition,
    character,
    installed,
    presentIds,
    animationAssets,
    reactionTarget,
  });
  const { valid, dialogueError } = values;
  const definitionActions = (
    <ActionBar
      className={s.saveBar}
      status={
        <span className={s.small}>
          {dialogueError
            ? `대사·반응: ${dialogueError}`
            : dirty
              ? "● 캐릭터 변경 · 키워드와 조합 대사는 별도 저장"
              : "키워드와 조합 대사는 별도 저장"}
        </span>
      }
    >
      <div className={s.compactActions}>
        {dirty && onCancel && (
          <Button
            size="small"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
            aria-label="캐릭터 수정 취소"
          >
            취소
          </Button>
        )}
        <Button
          size="small"
          variant="primary"
          disabled={pending || !valid || !dirty}
          onClick={onSave}
          aria-label="캐릭터 저장"
        >
          {pending ? "저장 중…" : "완료"}
        </Button>
      </div>
    </ActionBar>
  );
  return {
    ...values,
    definition,
    character,
    installed,
    presentIds,
    packDefinition,
    packBaseline,
    trialAssets,
    animationAssets,
    animationVersion,
    pending,
    children,
    isTogether,
    canEditCombination,
    reactionTarget,
    previewSelection,
    setPreviewSelection,
    assetSelections,
    setAssetSelections,
    npcPreviewIndex,
    setNpcPreviewIndex,
    dialogueType,
    chooseDialogueType,
    tab,
    navigate,
    tabsId,
    change,
    changeNpc,
    definitionActions,
  };
}
