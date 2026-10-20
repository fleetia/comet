import { useId, type CSSProperties, type JSX } from "react";
import { useArgs } from "storybook/preview-api";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { tokens } from "@comet/token";
import { Button, Select, StatusIndicator, TextInput } from "@comet/ui";

const PROVIDERS = [
  { value: "apple", label: "Apple 온디바이스 AI" },
  { value: "local", label: "이 기기의 모델" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "glm", label: "GLM" },
  { value: "custom", label: "사용자 지정 API" },
] as const;

type Provider = (typeof PROVIDERS)[number]["value"];
type ConnectionState = "unverified" | "checking" | "connected" | "error";
type ExampleProps = {
  provider: Provider;
  connectionState: ConnectionState;
  model: string;
  savedKey: boolean;
  platform: "macos" | "windows" | "other";
  sharing: boolean;
  appleAvailable: boolean;
  onProviderChange: (provider: Provider) => void;
  onModelChange: (model: string) => void;
  onConnect: () => void;
};

const MODEL_EXAMPLES = {
  claude: ["claude-opus-5-5"],
  gemini: ["gemini-3.8-flash"],
  glm: ["glm-5.3"],
  custom: [],
};
const CONNECTION_LABELS: Record<ConnectionState, string> = {
  unverified: "연결 확인 전",
  checking: "연결 확인 중…",
  connected: "연결을 확인했어요.",
  error: "연결하지 못했어요. 키와 모델 이름을 확인해 주세요.",
};
const STACK: CSSProperties = { display: "grid", gap: 16, minWidth: 0 };
const CAPTION: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: tokens["color/ink-2"],
};

function AIProviderSettingsExample({
  provider,
  connectionState,
  model,
  savedKey,
  platform,
  sharing,
  appleAvailable,
  onProviderChange,
  onModelChange,
  onConnect,
}: ExampleProps): JSX.Element {
  const modelListId = useId();
  const isChecking = connectionState === "checking";
  const selected = PROVIDERS.find((option) => option.value === provider);
  const isApi = provider !== "local" && provider !== "chatgpt" && provider !== "apple";
  const recommended = platform === "macos" ? "apple" : platform === "windows" ? "chatgpt" : null;
  const visibleProviders = PROVIDERS.filter(
    (option) => option.value !== "apple" || platform === "macos" || provider === "apple",
  );
  const options = [
    ...visibleProviders.filter((option) => option.value === recommended),
    ...visibleProviders.filter((option) => platform === "macos" && option.value === "chatgpt"),
    ...visibleProviders.filter(
      (option) =>
        option.value !== recommended && !(platform === "macos" && option.value === "chatgpt"),
    ),
  ];

  return (
    <section aria-label="AI 연결 설정 예제" style={{ ...STACK, width: 332, maxWidth: "100%" }}>
      <Select
        label="대화에 쓸 AI"
        value={provider}
        disabled={isChecking}
        style={{ width: "100%" }}
        description="선택한 AI는 저장 후 사용해요."
        onChange={(event) => {
          const next = PROVIDERS.find((option) => option.value === event.currentTarget.value);
          if (next) {
            onProviderChange(next.value);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.value === recommended ? " · 추천" : ""}
          </option>
        ))}
      </Select>
      {recommended && (
        <p style={CAPTION}>이 환경의 추천을 먼저 표시해요. 저장한 선택은 유지해요.</p>
      )}

      {provider === "apple" && (
        <>
          <StatusIndicator>
            {appleAvailable
              ? "한국어 사용 가능 · 응답 확인 전"
              : "Apple 모델이 아직 준비되지 않았어요."}
          </StatusIndicator>
          <p style={CAPTION}>
            기기 안에서 처리해요. 모델 준비는 macOS가 관리하며 다른 AI로 자동 전송하지 않아요.
          </p>
          <p style={CAPTION}>
            짧은 대화 · 요약 · 추출을 위한 텍스트 경로예요. 한국어 품질은 평가 중이며 위젯
            코드·첨부·긴 문맥은 지원하지 않아요.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="small" disabled={isChecking} onClick={onConnect}>
              다시 확인
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={isChecking || !appleAvailable}
              onClick={onConnect}
            >
              응답 확인
            </Button>
          </div>
          <p style={CAPTION}>상태 확인과 응답 확인은 설정을 저장하지 않아요.</p>
        </>
      )}

      {provider === "local" && (
        <>
          <Select label="로컬 모델" defaultValue="" style={{ width: "100%" }}>
            <option value="" disabled>
              모델을 선택해 주세요
            </option>
            <option value="custom">직접 지정한 GGUF 파일</option>
          </Select>
          <p style={CAPTION}>모델을 내려받거나 기기에 있는 GGUF 파일을 선택해요.</p>
          <div>
            <Button variant="ghost" size="small" onClick={onConnect}>
              파일 고르기…
            </Button>
          </div>
        </>
      )}

      {provider === "chatgpt" && (
        <>
          {connectionState === "connected" ? (
            <>
              <Select label="ChatGPT 계정" defaultValue="example" style={{ width: "100%" }}>
                <option value="example">comet@example.com</option>
              </Select>
              <Select
                label="ChatGPT 모델"
                defaultValue="account-model"
                disabled={!sharing}
                style={{ width: "100%" }}
              >
                <option value="account-model">계정에서 제공하는 모델</option>
              </Select>
              <StatusIndicator>
                {sharing
                  ? "플랜 권한과 모델 확인됨 · 실제 요청은 사용량에 따라 달라져요"
                  : "로그인됨 · 플랜 사용 권한 없음"}
              </StatusIndicator>
              {!sharing && (
                <p style={CAPTION}>
                  전송 안내에 동의한 뒤 다시 연결하거나 다른 AI를 선택해 주세요.
                </p>
              )}
            </>
          ) : (
            <>
              <p style={CAPTION}>ChatGPT 계정으로 로그인해 연결해요.</p>
              <div>
                <Button disabled={isChecking} onClick={onConnect}>
                  {isChecking ? "로그인 기다리는 중…" : "ChatGPT로 로그인"}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {isApi && (
        <>
          <fieldset disabled={isChecking} style={{ ...STACK, margin: 0, padding: 0, border: 0 }}>
            <legend style={{ marginBottom: 16, padding: 0, fontSize: 14, fontWeight: 600 }}>
              {selected?.label} 연결
            </legend>
            {provider === "custom" && (
              <TextInput
                label="API 주소"
                type="url"
                placeholder="https://api.example.com/v1"
                description="OpenAI 호환 API 주소를 입력해요."
                autoComplete="off"
                spellCheck={false}
                style={{ width: "100%" }}
              />
            )}
            <TextInput
              label="모델 이름"
              value={model}
              list={modelListId}
              placeholder="사용할 모델 이름"
              description={
                provider === "custom"
                  ? "서비스에 적힌 모델 이름 그대로 입력해요."
                  : "목록의 예시를 고르거나 모델 이름을 직접 입력해요."
              }
              spellCheck={false}
              style={{ width: "100%" }}
              onChange={(event) => onModelChange(event.currentTarget.value)}
            />
            <datalist id={modelListId}>
              {MODEL_EXAMPLES[provider].map((example) => (
                <option key={example} value={example} />
              ))}
            </datalist>
            <TextInput
              key={provider}
              label={provider === "custom" ? "API 키" : `${selected?.label} API 키`}
              type="password"
              placeholder={savedKey ? "저장됨 · 바꾸려면 새 키 입력" : "API 키를 입력해 주세요"}
              description="서비스별 키는 운영체제 보안 저장소에 따로 보관해요."
              autoComplete="off"
              spellCheck={false}
              style={{ width: "100%" }}
              error={connectionState === "error" ? "키와 모델 이름을 확인해 주세요." : undefined}
            />
            {provider === "custom" && (
              <Select
                label="응답 길이 매개변수"
                defaultValue="max_tokens"
                style={{ width: "100%" }}
              >
                <option value="max_tokens">max_tokens</option>
                <option value="max_completion_tokens">max_completion_tokens</option>
              </Select>
            )}
          </fieldset>
          <StatusIndicator
            pulse={isChecking}
            style={connectionState === "error" ? { color: tokens["color/danger"] } : undefined}
          >
            {CONNECTION_LABELS[connectionState]}
          </StatusIndicator>
          <div>
            <Button variant="ghost" size="small" disabled={isChecking} onClick={onConnect}>
              연결 확인
            </Button>
          </div>
          <p style={CAPTION}>연결 확인만으로 사용하는 AI가 바뀌지는 않아요.</p>
        </>
      )}
      <p style={CAPTION}>AI가 없어도 인사, 단어장, 대화팩 대사는 그대로 동작해요.</p>
    </section>
  );
}

const meta = {
  title: "UI/Patterns/AIProviderSettings",
  component: AIProviderSettingsExample,
  tags: ["autodocs"],
  args: {
    provider: "claude",
    connectionState: "unverified",
    model: "",
    savedKey: false,
    platform: "other",
    sharing: true,
    appleAvailable: false,
    onProviderChange: () => {},
    onModelChange: () => {},
    onConnect: () => {},
  },
  argTypes: {
    provider: { control: "select", options: PROVIDERS.map((option) => option.value) },
    connectionState: { control: "select", options: Object.keys(CONNECTION_LABELS) },
    model: { control: "text" },
    savedKey: { control: "boolean" },
    platform: { control: "select", options: ["macos", "windows", "other"] },
    sharing: { control: "boolean" },
    appleAvailable: { control: "boolean" },
    onProviderChange: { control: false },
    onModelChange: { control: false },
    onConnect: { control: false, action: "연결 동작 요청" },
  },
  render: (args) => {
    const [, updateArgs] = useArgs<ExampleProps>();
    return (
      <AIProviderSettingsExample
        {...args}
        onProviderChange={(provider) =>
          updateArgs({ provider, model: "", connectionState: "unverified", savedKey: false })
        }
        onModelChange={(model) => updateArgs({ model, connectionState: "unverified" })}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        component:
          "기존 Select·TextInput·Button·StatusIndicator를 조합한 332px AI 설정 예제입니다. macOS는 Apple 온디바이스 AI, Windows는 ChatGPT를 먼저 추천하되 저장한 선택을 바꾸지 않습니다. Apple 가용성과 응답 검사, ChatGPT 로그인·플랜 권한·모델 상태를 구분합니다. [Figma AI 화면](https://www.figma.com/design/aWNznF6uo5AlqF0YokiXZY?node-id=777-25840)과 연결됩니다. Controls는 상태 예제이며 인증·추론·저장을 실행하지 않습니다. 실제 앱은 제공자별 설정을 보존하고 저장할 때 선택한 AI를 전환합니다.",
      },
    },
  },
} satisfies Meta<typeof AIProviderSettingsExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Claude: Story = { name: "Claude · 연결 전" };
export const Gemini: Story = { name: "Gemini · 연결 전", args: { provider: "gemini" } };
export const Glm: Story = { name: "GLM · 연결 전", args: { provider: "glm" } };
export const CustomApi: Story = { name: "사용자 지정 API", args: { provider: "custom" } };
export const Local: Story = { name: "이 기기의 모델", args: { provider: "local" } };
export const ChatGptLogin: Story = { name: "ChatGPT · 로그인", args: { provider: "chatgpt" } };
export const ChatGptConnected: Story = {
  name: "ChatGPT · 계정과 모델",
  args: { provider: "chatgpt", connectionState: "connected" },
};
export const AppleUnavailable: Story = {
  name: "Apple · 모델 준비 필요",
  args: { provider: "apple", platform: "macos" },
};
export const AppleAvailable: Story = {
  name: "Apple · 한국어 사용 가능",
  args: { provider: "apple", platform: "macos", appleAvailable: true },
};
export const WindowsSavedProvider: Story = {
  name: "Windows · 추천과 저장 선택 보존",
  args: { provider: "claude", platform: "windows" },
};
export const ChatGptNoPlanPermission: Story = {
  name: "ChatGPT · 로그인됨, 플랜 권한 없음",
  args: { provider: "chatgpt", platform: "windows", connectionState: "connected", sharing: false },
};
export const Checking: Story = {
  name: "API · 연결 확인 중",
  args: { connectionState: "checking", model: "claude-opus-5-5", savedKey: true },
};
export const Connected: Story = {
  name: "API · 연결됨",
  args: { connectionState: "connected", model: "claude-opus-5-5", savedKey: true },
};
export const ConnectionError: Story = {
  name: "API · 연결 실패",
  args: { connectionState: "error", model: "claude-opus-5-5", savedKey: true },
};
