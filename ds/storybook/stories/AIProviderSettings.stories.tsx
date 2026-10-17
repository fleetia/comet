import { useId, type CSSProperties, type JSX } from "react";
import { useArgs } from "storybook/preview-api";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { tokens } from "@comet/token";
import { Button, Select, StatusIndicator, TextInput } from "@comet/ui";

const PROVIDERS = [
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
  onProviderChange,
  onModelChange,
  onConnect,
}: ExampleProps): JSX.Element {
  const modelListId = useId();
  const isChecking = connectionState === "checking";
  const selected = PROVIDERS.find((option) => option.value === provider);
  const isApi = provider !== "local" && provider !== "chatgpt";

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
        {PROVIDERS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

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
              <Select label="ChatGPT 모델" defaultValue="account-model" style={{ width: "100%" }}>
                <option value="account-model">계정에서 제공하는 모델</option>
              </Select>
              <StatusIndicator>ChatGPT에 로그인했어요.</StatusIndicator>
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
    onProviderChange: () => {},
    onModelChange: () => {},
    onConnect: () => {},
  },
  argTypes: {
    provider: { control: "select", options: PROVIDERS.map((option) => option.value) },
    connectionState: { control: "select", options: Object.keys(CONNECTION_LABELS) },
    model: { control: "text" },
    savedKey: { control: "boolean" },
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
          "6개 AI 제공자는 기존 Select로 선택하고, ChatGPT는 계정 로그인, Claude·Gemini·GLM은 키와 모델 이름, 사용자 지정 API는 주소와 응답 길이 매개변수를 함께 표시합니다. 모델 목록은 입력 예시이며 직접 입력을 허용합니다. 332px 너비에서 기존 Select·TextInput·Button·StatusIndicator를 조합한 사용 예제입니다. [Figma 제공자 선택 예제](https://www.figma.com/design/aWNznF6uo5AlqF0YokiXZY?node-id=635-35839)와 연결됩니다. 연결 상태는 Controls에서 바꾸며 인증·API 요청·키 보관·설정 저장은 실행하지 않습니다. 실제 앱은 제공자별 키와 모델을 보존하고 저장할 때 선택한 AI를 전환합니다.",
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
