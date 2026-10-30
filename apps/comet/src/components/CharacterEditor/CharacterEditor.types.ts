import type { ReactNode } from "react";
import type {
  AnimationAsset,
  CharacterAnimation,
  CharacterDefinition,
  InstalledCharacter,
  PackStoryDefinition,
} from "../../types";

export type DialogueType = "lines" | "reactions" | "keyword" | "scenes";

export type CharacterEditorProps = {
  definition: CharacterDefinition;
  character?: InstalledCharacter;
  installed?: InstalledCharacter[];
  presentIds?: string[];
  packDefinition?: PackStoryDefinition;
  packBaseline?: string;
  trialAssets?: Record<string, AnimationAsset[]>;
  onChange: (definition: CharacterDefinition) => void;
  onSave: () => void;
  onCancel?: () => void;
  onSprite?: (expression: string, remove: boolean) => void;
  animationAssets?: AnimationAsset[];
  animationVersion?: number;
  onAnimationChange?: (animation: CharacterAnimation, assets?: AnimationAsset[]) => void;
  onChooseAnimationAssets?: () => Promise<AnimationAsset[]>;
  pending: boolean;
  dirty: boolean;
  children?: ReactNode;
  memoryContent?: ReactNode | ((onManage: () => void) => ReactNode);
  settingsContent?: ReactNode;
  memoryTabRequest?: number;
  /**
   * Opens this friend on a tab once per revision, e.g. the balloon tab from theme settings.
   * `relationshipTarget` opens that relationship's name reaction, adding a draft if missing.
   */
  tabRequest?: {
    id: string;
    revision: number;
    tab?: "balloon" | "relationships";
    relationshipTarget?: string;
  } | null;
  /** From a visiting friend's page, edits how a resident reacts to its name. */
  onOpenReaction?: (residentId: string) => void;
  onOpenTheme?: () => void;
  isTogether?: boolean;
  dialogueType?: DialogueType;
  onDialogueTypeChange?: (type: DialogueType) => void;
  canEditCombination?: boolean;
  packName?: string;
  packContent?: ReactNode;
  lifeContent?: ReactNode | ((visible: boolean) => ReactNode);
  headerActions?: ReactNode;
  onBack?: () => void;
  onTalk?: () => void;
  onHistory?: () => void;
  onTogetherChange?: (together: boolean) => void;
  togetherDisabled?: boolean;
  onRemove?: () => void;
  removeDisabled?: boolean;
  onExport?: () => void;
  statusDescription?: string;
};
