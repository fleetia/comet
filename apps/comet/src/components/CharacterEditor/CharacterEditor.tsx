import type { JSX } from "react";
import { Button, Tabs } from "@comet/ui";
import { ChevLeftIcon, Icon } from "@comet/icon";
import { TabPanel, externalTabPanels } from "../../primitives";
import { FriendOverview } from "./FriendOverview";
import { AppearanceEditor } from "./AppearanceEditor";
import { BalloonAppearance } from "./BalloonAppearance";
import { CharacterProfilePanel } from "./CharacterProfilePanel";
import { CharacterRelationshipsPanel } from "./CharacterRelationshipsPanel";
import { CharacterDialoguePanel } from "./CharacterDialoguePanel";
import { CharacterLifePanel } from "./CharacterLifePanel";
import type { CharacterEditorProps } from "./CharacterEditor.types";
import { useCharacterEditor } from "./useCharacterEditor";
import * as detail from "./friendDetail.css";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

export const EXPRESSIONS = ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"];
export type { DialogueType } from "./CharacterEditor.types";

const EDITOR_TABS = [
  { value: "overview", label: "친구 정보", content: null },
  { value: "profile", label: "프로필", content: null },
  { value: "appearance", label: "모습·표정", content: null },
  { value: "balloon", label: "말풍선", content: null },
  { value: "dialogue", label: "대사·반응", content: null },
  { value: "life", label: "등장·이야기", content: null },
  { value: "relationships", label: "다른 친구와의 관계", content: null },
  { value: "memory", label: "기억", content: null },
  { value: "settings", label: "관리", content: null },
];

export function CharacterEditor(props: CharacterEditorProps): JSX.Element {
  const editor = useCharacterEditor(props);
  const {
    definition,
    character,
    installed,
    presentIds,
    pending,
    isTogether,
    tab,
    setTab,
    tabsId,
    definitionActions,
    animationAssets,
    animationVersion,
    assetSelections,
    setAssetSelections,
    change,
  } = editor;
  const {
    onChange,
    onSprite,
    onAnimationChange,
    onChooseAnimationAssets,
    memoryContent,
    settingsContent,
    lifeContent,
    onOpenTheme,
    headerActions,
    onBack,
    onTalk,
    onHistory,
    onTogetherChange,
    togetherDisabled,
    onRemove,
    removeDisabled,
    onExport,
    statusDescription,
    onOpenReaction,
  } = props;
  return (
    <div className={s.editor}>
      {tab !== "overview" && (
        <nav className={detail.breadcrumbs} aria-label="친구 편집 경로">
          <Button
            variant="ghost"
            size="small"
            aria-label="친구들로 돌아가기"
            onClick={() => {
              setTab("overview");
              onBack?.();
            }}
          >
            <ChevLeftIcon size={15} />
            친구들
          </Button>
          <Icon name="chev" size={13} />
          <Button
            variant="ghost"
            size="small"
            aria-label="친구 정보로 돌아가기"
            onClick={() => setTab("overview")}
          >
            {definition.name || "새 친구"}
          </Button>
          <Icon name="chev" size={13} />
          <span className={detail.currentCrumb}>
            {
              {
                profile: "프로필",
                appearance: "모습·표정",
                balloon: "말풍선",
                dialogue: "대사·반응",
                life: "등장·이야기",
                relationships: "다른 친구와의 관계",
                memory: "기억",
                settings: "관리",
              }[tab]
            }
          </span>
        </nav>
      )}
      <div hidden>
        <Tabs
          label="캐릭터 편집"
          items={EDITOR_TABS}
          value={tab}
          onValueChange={setTab}
          externalPanels={externalTabPanels(
            tabsId,
            EDITOR_TABS.map((item) => item.value),
          )}
        />
      </div>
      <TabPanel tabs={tabsId} value="overview" selected={tab} className={s.editorPanel}>
        {
          <FriendOverview
            character={character}
            definition={definition}
            installed={installed}
            isTogether={isTogether}
            statusDescription={statusDescription}
            togetherDisabled={togetherDisabled}
            removeDisabled={removeDisabled}
            onTogetherChange={onTogetherChange}
            onBack={onBack}
            onTalk={onTalk}
            onExport={onExport}
            onRemove={onRemove}
            onOpen={(page) => {
              if (page === "history") onHistory?.();
              else setTab(page);
            }}
            headerActions={headerActions}
            presentIds={presentIds}
            onOpenReaction={onOpenReaction}
          />
        }
      </TabPanel>
      <TabPanel tabs={tabsId} value="profile" selected={tab} className={s.editorPanel}>
        <CharacterProfilePanel editor={editor} />
      </TabPanel>
      <TabPanel tabs={tabsId} value="relationships" selected={tab} className={s.editorPanel}>
        <CharacterRelationshipsPanel editor={editor} />
      </TabPanel>
      <TabPanel tabs={tabsId} value="appearance" selected={tab} className={s.editorPanel}>
        <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
          <AppearanceEditor
            key={`${character?.id ?? "new"}:${animationVersion}`}
            footer={definitionActions}
            definition={definition}
            character={character}
            selection={assetSelections[character?.id ?? "new"]}
            onSelectionChange={(value) =>
              setAssetSelections((previous) => ({ ...previous, [character?.id ?? "new"]: value }))
            }
            onSprite={onSprite}
            assets={animationAssets}
            visible={tab === "appearance"}
            onChange={onChange}
            onAnimationChange={onAnimationChange ?? ((animation) => change("animation", animation))}
            onChooseAssets={onChooseAnimationAssets}
          />
        </fieldset>
      </TabPanel>
      <TabPanel tabs={tabsId} value="balloon" selected={tab} className={s.editorPanel}>
        <fieldset className={`${s.fieldset} ${e.fullHeight}`} disabled={pending}>
          <BalloonAppearance
            footer={definitionActions}
            visible={tab === "balloon"}
            definition={definition}
            character={character}
            onSprite={onSprite}
            onOpenTheme={onOpenTheme}
            onChange={(patch) => onChange({ ...definition, ...patch })}
          />
        </fieldset>
      </TabPanel>
      <TabPanel tabs={tabsId} value="dialogue" selected={tab} className={s.editorPanel}>
        <CharacterDialoguePanel editor={editor} />
      </TabPanel>
      <TabPanel tabs={tabsId} value="life" selected={tab} className={s.editorPanel}>
        <CharacterLifePanel editor={editor}>
          {typeof lifeContent === "function" ? lifeContent(tab === "life") : lifeContent}
        </CharacterLifePanel>
      </TabPanel>
      <TabPanel tabs={tabsId} value="memory" selected={tab} className={s.editorPanel}>
        {(typeof memoryContent === "function"
          ? memoryContent(() => setTab("settings"))
          : memoryContent) ?? (
          <p className={s.small}>캐릭터를 저장하면 함께 나눈 기억을 볼 수 있어요.</p>
        )}
      </TabPanel>
      <TabPanel tabs={tabsId} value="settings" selected={tab} className={s.editorPanel}>
        {settingsContent ?? <p className={s.small}>캐릭터를 먼저 저장해 주세요.</p>}
      </TabPanel>
    </div>
  );
}
