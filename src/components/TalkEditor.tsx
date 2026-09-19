import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Select, TextArea } from "@fleetia/lagrange";
import { command, errorText } from "../hooks/useSnapshot";
import * as ui from "../lagrange.css";
import * as s from "./story.css";

type Document = { path: string; source: string; revision: string };
type Props = {
  onDirtyChange: (dirty: boolean) => void;
  onPendingChange: (pending: boolean) => void;
};

export function TalkEditor({ onDirtyChange, onPendingChange }: Props): JSX.Element {
  const [files, setFiles] = useState<string[]>([]);
  const [document, setDocument] = useState<Document | null>(null);
  const [source, setSource] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const lock = useRef(false);
  const dirty = document !== null && source !== document.source;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onPendingChange(pending);
  }, [pending, onPendingChange]);
  useEffect(() => {
    let active = true;
    setPending(true);
    void command<string[]>("list_talk_files")
      .then(async (paths) => {
        if (!active) return;
        setFiles(paths);
        if (paths.length === 0) return;
        const loaded = await command<Document>("read_talk_file", {
          path: paths.includes("index.talk") ? "index.talk" : paths[0],
        });
        if (active) {
          setDocument(loaded);
          setSource(loaded.source);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function load(path: string): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await command<Document>("read_talk_file", { path });
      setDocument(loaded);
      setSource(loaded.source);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function save(): Promise<void> {
    if (!document || lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await command<Document>("save_talk_file", {
        path: document.path,
        source,
        expectedRevision: document.revision,
      });
      setDocument(saved);
      setSource(saved.source);
      setNotice("대본을 검사하고 암호화해 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label="대본 에디터">
      <p className={ui.quiet}>
        시간·날씨·위젯 대사를 편집해요. 저장할 때 대본 전체를 검사하고 파일을 암호화해요.
      </p>
      <label className={ui.field}>
        대본 파일
        <Select
          value={document?.path ?? ""}
          disabled={pending || dirty}
          onChange={(event) => void load(event.target.value)}
        >
          <option value="" disabled>
            파일 선택
          </option>
          {files.map((path) => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </Select>
      </label>
      <TextArea
        aria-label="대본 원문"
        className={s.source}
        value={source}
        spellCheck={false}
        disabled={pending || !document}
        onChange={(event) => {
          setSource(event.target.value);
          setNotice(null);
        }}
      />
      <div className={ui.row}>
        <Button disabled={!dirty || pending} onClick={() => void save()}>
          {pending ? "처리 중" : "검사하고 저장"}
        </Button>
        <Button
          variant="quiet"
          disabled={!document || pending}
          onClick={() => document && void load(document.path)}
        >
          다시 불러오기
        </Button>
        {dirty && <span className={ui.quiet}>저장하지 않은 변경이 있어요.</span>}
      </div>
      {error && (
        <p className={`${ui.error} ${s.diagnostics}`} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={ui.success} role="status">
          {notice}
        </p>
      )}
      {!pending && files.length === 0 && !error && (
        <p className={ui.quiet}>편집할 대본 파일이 없어요.</p>
      )}
    </section>
  );
}
