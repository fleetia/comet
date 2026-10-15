import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { diffSnapshots, FILE_KEY, stableStringify, validateSnapshot } from "./figma-rest.mjs";

const REPOSITORY = "fleetia/comet";
const BRANCH = "codex/figma-sync";
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const BASELINE = "ds/automation/figma-baseline.json";
const NEXT_BASELINE = "test-results/figma-sync/next-baseline.json";
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
const MAX_BODY_BYTES = 50_000;
const REPORT_START = "<!-- figma-report:start -->";
const REPORT_END = "<!-- figma-report:end -->";
const AUTO_CLOSED = "<!-- figma-report:closed-after-revert -->";

function gitRunner(root, args, { env = {}, input } = {}) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return execFileSync(
    "/usr/bin/git",
    [
      "--literal-pathspecs",
      "--no-pager",
      "-c",
      `safe.directory=${resolve(root)}`,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "diff.external=",
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...inherited,
        ...env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
      },
      input,
      encoding: "utf8",
      maxBuffer: MAX_SNAPSHOT_BYTES + 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function readSnapshot(root) {
  const parts = NEXT_BASELINE.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const stat = lstatSync(resolve(root, ...parts.slice(0, i)));
    if (stat.isSymbolicLink() || (i < parts.length ? !stat.isDirectory() : !stat.isFile()))
      throw new Error("Figma snapshot must be a regular file without symlink ancestors");
  }
  const fd = openSync(resolve(root, NEXT_BASELINE), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_SNAPSHOT_BYTES)
      throw new Error("Invalid or oversized Figma snapshot");
    return validateSnapshot(JSON.parse(readFileSync(fd, "utf8")));
  } finally {
    closeSync(fd);
  }
}

function snapshotAt(git, ref) {
  const entry = git(["ls-tree", "-z", ref, "--", BASELINE]);
  if (!entry) return null;
  if (!/^100644 blob [a-f0-9]{40}\tds\/automation\/figma-baseline\.json\0$/.test(entry))
    throw new Error("Committed Figma baseline must be a regular JSON file");
  const size = Number(git(["cat-file", "-s", `${ref}:${BASELINE}`]).trim());
  if (!Number.isSafeInteger(size) || size > MAX_SNAPSHOT_BYTES)
    throw new Error("Committed Figma baseline is too large");
  return validateSnapshot(JSON.parse(git(["show", `${ref}:${BASELINE}`])));
}

function candidateTree(git, sha, snapshot) {
  const directory = mkdtempSync(resolve(tmpdir(), "figma-report-index-"));
  const env = { GIT_INDEX_FILE: resolve(directory, "index") };
  try {
    const blob = git(["hash-object", "-w", "--stdin"], {
      input: `${JSON.stringify(snapshot, null, 2)}\n`,
    }).trim();
    git(["read-tree", sha], { env });
    git(["update-index", "--add", "--cacheinfo", `100644,${blob},${BASELINE}`], { env });
    return git(["write-tree"], { env }).trim();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function markdown(value, max = 250) {
  const text = String(value);
  return (
    (text.length > max ? `${text.slice(0, max)}…` : text)
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/@/g, "@\u200b")
      .replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&")
  );
}

function display(value) {
  return value === undefined ? "(없음)" : markdown(stableStringify(value));
}

function keyedNodes(value) {
  return (
    Array.isArray(value) &&
    value.every((item) => item && typeof item === "object" && typeof item.id === "string") &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}

export function propertyChanges(before, after, limit = 40) {
  const changes = [];
  let truncated = false;
  function emit(path, previous, next) {
    if (changes.length < limit) changes.push({ path, before: previous, after: next });
    else truncated = true;
  }
  function visit(previous, next, path) {
    if (truncated || Object.is(previous, next)) return;
    if (Array.isArray(previous) && Array.isArray(next)) {
      if (keyedNodes(previous) && keyedNodes(next)) {
        const oldNodes = new Map(previous.map((item) => [item.id, item]));
        const newNodes = new Map(next.map((item) => [item.id, item]));
        const oldOrder = previous.map((item) => item.id).filter((id) => newNodes.has(id));
        const newOrder = next.map((item) => item.id).filter((id) => oldNodes.has(id));
        if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder))
          emit(`${path}.순서`, oldOrder, newOrder);
        for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()]))
          visit(oldNodes.get(id), newNodes.get(id), `${path}[id=${id}]`);
      } else {
        for (let i = 0; i < Math.max(previous.length, next.length); i++)
          visit(previous[i], next[i], `${path}[${i}]`);
      }
    } else if (
      previous &&
      next &&
      typeof previous === "object" &&
      typeof next === "object" &&
      !Array.isArray(previous) &&
      !Array.isArray(next)
    ) {
      for (const key of [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort())
        visit(
          Object.hasOwn(previous, key) ? previous[key] : undefined,
          Object.hasOwn(next, key) ? next[key] : undefined,
          path ? `${path}.${key}` : key,
        );
    } else {
      emit(path || "컴포넌트", previous, next);
    }
  }
  visit(before, after, "");
  return { changes, truncated };
}

function componentLink(entry) {
  return `[${markdown(entry.context.node.name || entry.id)}](https://www.figma.com/design/${FILE_KEY}?node-id=${entry.id.replace(":", "-")})`;
}

export function reportBody(baseline, snapshot, sha, snapshotSha) {
  if (
    ![sha, snapshotSha].every((value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value))
  )
    throw new Error("Report links require full commit SHAs");
  const changes = baseline ? diffSnapshots(baseline, snapshot) : null;
  const lines = [
    REPORT_START,
    baseline
      ? "매시간 Figma를 조회해 main의 기준 스냅샷과 비교한 변경 보고입니다. 이 PR은 비교 데이터만 갱신하며 디자인시스템 코드를 수정하거나 AI를 실행하지 않습니다."
      : "Figma 변경 감지를 시작할 최초 기준 스냅샷을 등록합니다. 처음 수집한 상태이며, 기존 디자인의 변경이나 코드와의 일치 여부를 뜻하지 않습니다.",
    "",
    `[Figma 원본](https://www.figma.com/design/${FILE_KEY}) · [전체 스냅샷](https://github.com/${REPOSITORY}/blob/${snapshotSha}/${BASELINE}) · [전체 JSON 차이](https://github.com/${REPOSITORY}/compare/${sha}...${snapshotSha})`,
    "",
    baseline
      ? `추가 ${changes.added.length}개 · 변경 ${changes.changed.length}개 · 삭제 ${changes.removed.length}개`
      : `기준 컴포넌트 ${snapshot.entries.length}개를 등록합니다.`,
    "",
    "UI·아이콘 컴포넌트의 속성, 하위 노드, 연결된 메타데이터를 비교합니다. 스냅샷은 JSON 데이터이며 화면 이미지는 포함하지 않습니다. 사용하지 않는 변수와 모든 변수 모드는 감지 범위에 포함하지 않습니다.",
  ];
  let budget = 40_000 - Buffer.byteLength(lines.join("\n"));
  let omitted = false;
  const previous = new Map(baseline?.entries.map((entry) => [entry.id, entry]) ?? []);
  const groups = changes
    ? [
        ["추가", changes.added],
        ["변경", changes.changed],
        ["삭제", changes.removed],
      ]
    : [["최초 수집", snapshot.entries]];
  for (const [label, entries] of groups) {
    for (const entry of entries) {
      const details = ["", `### ${label}: ${componentLink(entry)}`, ""];
      if (label === "변경") {
        const old = previous.get(entry.id);
        const difference = propertyChanges(
          { kind: old.kind, ...old.context },
          { kind: entry.kind, ...entry.context },
        );
        details.push("| 속성 경로 | 이전 | 현재 |", "| --- | --- | --- |");
        for (const change of difference.changes)
          details.push(
            `| ${markdown(change.path, 400)} | ${display(change.before)} | ${display(change.after)} |`,
          );
        if (difference.truncated)
          details.push("", "추가 속성 차이는 전체 JSON 차이에서 확인하세요.");
      } else {
        details.push(
          `${markdown(entry.kind)} · 노드 ${markdown(entry.id)}${label === "삭제" ? " · 삭제된 노드의 Figma 링크는 열리지 않을 수 있습니다." : ""}`,
        );
      }
      const size = Buffer.byteLength(details.join("\n"));
      if (size > budget) {
        omitted = true;
        continue;
      }
      budget -= size;
      lines.push(...details);
    }
  }
  if (omitted)
    lines.push(
      "",
      "본문 길이 제한으로 일부 컴포넌트를 생략했습니다. 전체 JSON 차이에서 모든 변경을 확인하세요.",
    );
  lines.push(
    "",
    "이 PR을 머지하면 다음 비교의 기준만 갱신되며, 디자인시스템 코드에 변경을 반영하는 것은 아닙니다. 자동 머지는 수행하지 않습니다.",
    REPORT_END,
  );
  return lines.join("\n");
}

function reportRange(body) {
  if (
    typeof body !== "string" ||
    body.split(REPORT_START).length !== 2 ||
    body.split(REPORT_END).length !== 2
  )
    throw new Error("Existing report markers were removed or changed; refusing to overwrite it");
  const start = body.indexOf(REPORT_START);
  const end = body.indexOf(REPORT_END) + REPORT_END.length;
  if (end < start) throw new Error("Existing report markers are out of order");
  return { start, end };
}

function replaceReport(body, report) {
  const { start, end } = reportRange(body);
  const updated = `${body.slice(0, start)}${report}${body.slice(end)}`;
  if (Buffer.byteLength(updated) > MAX_BODY_BYTES)
    throw new Error("Report and manual notes exceed the PR body size limit");
  return updated;
}

function githubClient(env, fetchImpl) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || typeof env.GH_TOKEN !== "string" || !env.GH_TOKEN)
    throw new Error("Publishing requires fleetia/comet and GH_TOKEN");
  return async (path, { method = "GET", body, allowMissing = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error("GitHub API request failed or timed out");
    }
    if (response.status === 404 && allowMissing) return null;
    if (!response.ok) throw new Error(`GitHub API request failed (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  };
}

function gitAuth(token) {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_TRACE: "0",
    GIT_TRACE_CURL: "0",
    GIT_CURL_VERBOSE: "0",
    GIT_TRACE_PACKET: "0",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "credential.helper",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_1: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}

function ownPull(pull) {
  return pull.head?.repo?.full_name === REPOSITORY && pull.head.ref === BRANCH;
}

export function validateExistingProposal(pulls, head, commitEmails, recoverOrphan = false) {
  const history = pulls.filter(ownPull);
  const open = history.find((pull) => pull.state === "open");
  const pull = open ?? history.find((item) => item.head.sha === head);
  const latest = history[0];
  if (
    latest?.state === "closed" &&
    !latest.merged_at &&
    !(latest.user?.login === BOT_NAME && latest.body?.includes(AUTO_CLOSED))
  )
    throw new Error(
      "A report PR was closed without merging; refusing to recreate it automatically",
    );
  if (!head) {
    if (open) throw new Error("An open report PR has no branch; refusing to replace it");
    return null;
  }
  if (commitEmails.some((emails) => emails !== `${BOT_EMAIL}\t${BOT_EMAIL}`))
    throw new Error("Existing report branch contains human commits; refusing to overwrite it");
  if (!pull && recoverOrphan && commitEmails.length === 1) return null;
  if (
    !pull ||
    pull.user?.login !== BOT_NAME ||
    pull.head.sha !== head ||
    pull.base?.ref !== "main" ||
    pull.base?.repo?.full_name !== REPOSITORY ||
    (pull.state === "open"
      ? pull.draft !== true
      : !pull.merged_at && !pull.body?.includes(AUTO_CLOSED))
  )
    throw new Error("Existing report branch is not an untouched bot draft or completed bot PR");
  if (pull.state === "open") {
    reportRange(pull.body);
    return pull;
  }
  return null;
}

export async function publish({
  root = process.cwd(),
  env = process.env,
  gitImpl = gitRunner,
  fetchImpl = fetch,
} = {}) {
  const git = (args, options) => gitImpl(root, args, options);
  const sha = env.FIGMA_BASE_SHA;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/.test(sha))
    throw new Error("FIGMA_BASE_SHA must be a full commit SHA");
  if (git(["rev-parse", "HEAD"]).trim() !== sha)
    throw new Error("Checkout no longer matches FIGMA_BASE_SHA");
  const snapshot = readSnapshot(root);
  const baseline = snapshotAt(git, sha);
  const changed = !baseline || stableStringify(baseline) !== stableStringify(snapshot);
  const api = githubClient(env, fetchImpl);
  const auth = gitAuth(env.GH_TOKEN);
  const remote = `https://github.com/${REPOSITORY}.git`;
  const assertRemoteBase = () => {
    if (git(["ls-remote", remote, "refs/heads/main"], { env: auth }).trim().split(/\s+/)[0] !== sha)
      throw new Error("main advanced; rerun the workflow against the latest main");
  };
  assertRemoteBase();
  const [ref, pulls] = await Promise.all([
    api(`/git/ref/heads/${BRANCH}`, { allowMissing: true }),
    api(
      `/pulls?${new URLSearchParams({ state: "all", head: `fleetia:${BRANCH}`, base: "main", sort: "updated", direction: "desc", per_page: "100" })}`,
    ),
  ]);
  if (!Array.isArray(pulls)) throw new Error("GitHub returned an invalid PR list");
  const head = ref?.object?.sha ?? "";
  const tree = changed ? candidateTree(git, sha, snapshot) : null;
  let commitEmails = [];
  let recoverOrphan = false;
  let pending = null;
  let pendingParent = "";
  if (head) {
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error("Invalid remote report SHA");
    git(["fetch", "--no-tags", remote, `+refs/heads/${BRANCH}:refs/figma/report`], { env: auth });
    if (git(["rev-parse", "refs/figma/report"]).trim() !== head)
      throw new Error("Report branch changed during validation; retry");
    const mergeBase = git(["merge-base", sha, head]).trim();
    commitEmails = git(["log", "--format=%ae%x09%ce", `${mergeBase}..${head}`])
      .trim()
      .split("\n")
      .filter(Boolean);
    const paths = git([
      "diff",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
      mergeBase,
      head,
      "--",
    ])
      .split("\0")
      .filter(Boolean);
    if (paths.some((path) => path !== BASELINE))
      throw new Error("Existing report branch changes files other than the Figma baseline");
    pending = snapshotAt(git, head);
    pendingParent = git(["show", "--no-patch", "--format=%P", head]).trim();
    recoverOrphan =
      !pulls.some((pull) => ownPull(pull) && (pull.state === "open" || pull.head.sha === head)) &&
      commitEmails.length === 1 &&
      pendingParent === sha &&
      git(["rev-parse", `${head}^{tree}`]).trim() === tree;
  }
  const existing = validateExistingProposal(pulls, head, commitEmails, recoverOrphan);
  const refreshPull = async (expectedHead = head) => {
    const fresh = await api(`/pulls/${existing.number}`);
    if (!validateExistingProposal([fresh], expectedHead, commitEmails))
      throw new Error("Report PR changed during validation; retry");
    return fresh;
  };
  if (!changed) {
    if (!existing) return { status: "unchanged" };
    assertRemoteBase();
    if (
      git(["ls-remote", remote, `refs/heads/${BRANCH}`], { env: auth })
        .trim()
        .split(/\s+/)[0] !== head
    )
      throw new Error("Report branch changed before closing; retry");
    const fresh = await refreshPull();
    const { start, end } = reportRange(fresh.body);
    const original = fresh.body.slice(start, end);
    const body = replaceReport(
      fresh.body,
      original.replace(
        REPORT_END,
        `\nFigma가 main 기준 상태로 돌아와 이 보고를 자동으로 닫았습니다.\n${AUTO_CLOSED}\n${REPORT_END}`,
      ),
    );
    await api(`/pulls/${existing.number}`, { method: "PATCH", body: { state: "closed", body } });
    return { status: "closed", url: `https://github.com/${REPOSITORY}/pull/${existing.number}` };
  }
  const samePending =
    existing &&
    pending &&
    pendingParent === sha &&
    stableStringify(pending) === stableStringify(snapshot);
  const title = baseline ? "chore: Figma 컴포넌트 변경 보고" : "chore: Figma 변경 감지 기준 등록";
  const commit = samePending
    ? head
    : git(["-c", "commit.gpgsign=false", "commit-tree", tree, "-p", sha], {
        input: `${title}\n`,
        env: {
          GIT_AUTHOR_NAME: BOT_NAME,
          GIT_AUTHOR_EMAIL: BOT_EMAIL,
          GIT_COMMITTER_NAME: BOT_NAME,
          GIT_COMMITTER_EMAIL: BOT_EMAIL,
        },
      }).trim();
  const report = reportBody(baseline, snapshot, sha, commit);
  const fresh = existing ? await refreshPull() : null;
  let body = fresh ? replaceReport(fresh.body, report) : report;
  if (samePending) {
    if (fresh.body === body && fresh.title === title)
      return {
        status: "unchanged",
        url: `https://github.com/${REPOSITORY}/pull/${existing.number}`,
      };
    assertRemoteBase();
    await api(`/pulls/${existing.number}`, { method: "PATCH", body: { title, body } });
    return { status: "updated", url: `https://github.com/${REPOSITORY}/pull/${existing.number}` };
  }
  assertRemoteBase();
  git(
    [
      "push",
      `--force-with-lease=refs/heads/${BRANCH}:${head}`,
      remote,
      `${commit}:refs/heads/${BRANCH}`,
    ],
    { env: auth },
  );
  if (existing) body = replaceReport((await refreshPull(commit)).body, report);
  const pull = existing
    ? await api(`/pulls/${existing.number}`, { method: "PATCH", body: { title, body } })
    : await api("/pulls", {
        method: "POST",
        body: { title, head: BRANCH, base: "main", draft: true, body },
      });
  if (
    typeof pull.html_url !== "string" ||
    !/^https:\/\/github\.com\/fleetia\/comet\/pull\/\d+$/.test(pull.html_url)
  )
    throw new Error("GitHub returned an invalid PR URL");
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Figma 변경 보고: ${pull.html_url}\n`);
  return { status: existing ? "updated" : "created", url: pull.html_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "publish")
      throw new Error("Usage: node ds/scripts/figma-proposal.mjs publish");
    console.log(JSON.stringify(await publish()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
