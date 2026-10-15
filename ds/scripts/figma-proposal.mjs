import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { FILE_KEY, stableStringify, validateChanges, validateSnapshot } from "./figma-rest.mjs";

const REPOSITORY = "fleetia/comet";
const BRANCH = "codex/figma-sync";
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const BASELINE = "ds/automation/figma-baseline.json";
const PREPARE = "test-results/figma-sync";
const PROPOSAL = "test-results/figma-proposal";
const MAX_PATCH_BYTES = 20 * 1024 * 1024;
const CODE_PREFIXES = [
  "ds/ui/src/",
  "ds/ui/figma/",
  "ds/icon/src/",
  "ds/icon/figma/",
  "ds/token/src/",
  "ds/token/figma/",
  "ds/storybook/stories/",
];

export function isAllowedPath(path, baseline = false) {
  // Control characters make Git patch path parsing ambiguous.
  return (
    typeof path === "string" &&
    // eslint-disable-next-line no-control-regex
    !/[\x00-\x1f\x7f\\]/.test(path) &&
    path.split("/").every((part) => part && !part.startsWith(".")) &&
    !["package.json", "AGENTS.md", "CLAUDE.md"].includes(path.split("/").at(-1)) &&
    /\.(?:ts|tsx|css|json|svg|mdx)$/.test(path) &&
    ((baseline && path === BASELINE) ||
      path === "ds/token/styles.css" ||
      CODE_PREFIXES.some((prefix) => path.startsWith(prefix)))
  );
}

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
      maxBuffer: MAX_PATCH_BYTES + 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

function context({
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
  return { root, env, git, sha, fetchImpl };
}

function nulList(text) {
  return text.split("\0").filter(Boolean);
}

function changedPaths(git) {
  return [
    ...new Set([
      ...nulList(
        git([
          "diff",
          "--name-only",
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          "HEAD",
          "--",
        ]),
      ),
      ...nulList(git(["ls-files", "--others", "--exclude-standard", "-z"])),
    ]),
  ];
}

function regularPath(root, path, allowMissing = false) {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const absolute = resolve(root, ...parts.slice(0, i));
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissing) return null;
      throw error;
    }
    if (stat.isSymbolicLink() || (i < parts.length ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(
        "Proposal and artifact paths must be regular files with no symlink ancestors",
      );
    }
    if (i === parts.length) return stat;
  }
}

function checkPaths(root, paths, baseline = false) {
  for (const path of paths) {
    if (!isAllowedPath(path, baseline))
      throw new Error(`Proposal contains a forbidden path: ${JSON.stringify(path)}`);
    regularPath(root, path, true);
  }
}

function checkIndex(git, paths, env = {}) {
  if (paths.length === 0) return;
  for (const item of nulList(git(["ls-files", "--stage", "-z", "--", ...paths], { env }))) {
    if (!/^100644 [a-f0-9]{40} 0\t/.test(item))
      throw new Error("Proposal index contains a symlink, executable, or submodule");
  }
}

function inside(path, parent) {
  const suffix = relative(parent, path);
  return (
    suffix === "" || (!suffix.startsWith(`..${sep}`) && suffix !== ".." && !isAbsolute(suffix))
  );
}

function temporaryRoot(root, env) {
  if (env.RUNNER_TEMP === undefined) return tmpdir();
  const path = env.RUNNER_TEMP;
  if (
    typeof path !== "string" ||
    !isAbsolute(path) ||
    inside(path, root) ||
    inside(path, tmpdir()) ||
    inside(path, "/tmp") ||
    (env.GITHUB_WORKSPACE && inside(path, env.GITHUB_WORKSPACE)) ||
    [...path].some((char) => char.charCodeAt(0) < 32)
  ) {
    throw new Error("RUNNER_TEMP must be outside the checkout and model-writable temporary roots");
  }
  for (let ancestor = resolve(path); ; ancestor = dirname(ancestor)) {
    const stat = lstatSync(ancestor);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("RUNNER_TEMP must have no symlink ancestors");
    if (dirname(ancestor) === ancestor) break;
  }
  return path;
}

function withIndex(git, callback, tempRoot = tmpdir()) {
  const directory = mkdtempSync(resolve(tempRoot, "figma-index-"));
  const objects = resolve(directory, "objects");
  mkdirSync(objects);
  const env = {
    GIT_INDEX_FILE: resolve(directory, "index"),
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: git([
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "objects",
    ]).trim(),
  };
  try {
    git(["read-tree", "HEAD"], { env });
    return callback(env);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function artifactFile(root, path, maxBytes) {
  regularPath(root, path);
  const absolute = resolve(root, path);
  const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes)
      throw new Error(`Invalid artifact: ${path}`);
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function jsonFile(root, path, maxBytes = 2 * 1024 * 1024) {
  return JSON.parse(artifactFile(root, path, maxBytes));
}

function writeArtifact(root, path, contents) {
  regularPath(root, path, true);
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  regularPath(root, path, true);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, contents, { flag: "wx", mode: 0o644 });
    regularPath(root, path, true);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function validateResult(result) {
  if (
    !result ||
    result.status !== "complete" ||
    typeof result.summary !== "string" ||
    result.summary.length > 4000 ||
    !Array.isArray(result.limitations) ||
    result.limitations.length > 20 ||
    result.limitations.some((item) => typeof item !== "string" || item.length > 500) ||
    Object.keys(result).some((key) => !["status", "summary", "limitations"].includes(key))
  ) {
    throw new Error("The model must report a complete, bounded proposal result");
  }
  return result;
}

function prepared(root) {
  return {
    changes: validateChanges(jsonFile(root, `${PREPARE}/changes.json`)),
    snapshot: validateSnapshot(jsonFile(root, `${PREPARE}/next-baseline.json`)),
  };
}

export function bundle(options = {}) {
  const { root, git, env } = context(options);
  const result = validateResult(jsonFile(root, `${PROPOSAL}/result.json`, 32 * 1024));
  const tempRoot = temporaryRoot(root, env);
  const paths = changedPaths(git);
  checkPaths(root, paths);
  const patch = withIndex(
    git,
    (env) => {
      if (paths.length) git(["add", "-A", "--", ...paths], { env });
      checkIndex(git, paths, env);
      return git(
        [
          "diff",
          "--cached",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "HEAD",
          "--",
        ],
        { env },
      );
    },
    tempRoot,
  );
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error("Proposal patch exceeds 20 MiB");
  const artifactPath = env.RUNNER_TEMP
    ? mkdtempSync(resolve(tempRoot, "figma-proposal-"))
    : resolve(root, PROPOSAL);
  writeArtifact(artifactPath, "proposal.patch", patch);
  writeArtifact(artifactPath, "result.json", `${JSON.stringify(result, null, 2)}\n`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `artifact_path=${artifactPath}\n`);
  return { paths, artifactPath };
}

export function apply(options = {}) {
  const { root, git, env: contextEnv } = context(options);
  if (changedPaths(git).length) throw new Error("Applying a proposal requires a clean checkout");
  const { snapshot, changes } = prepared(root);
  const hasPatch = regularPath(root, `${PROPOSAL}/proposal.patch`, true) !== null;
  if (!hasPatch && !changes.baselineOnly) throw new Error("Proposal patch is missing");
  if (changes.baselineOnly && hasPatch)
    throw new Error("Baseline initialization must not include a model patch");
  if (!changes.baselineOnly) {
    validateResult(jsonFile(root, `${PROPOSAL}/result.json`, 32 * 1024));
    const patch = artifactFile(root, `${PROPOSAL}/proposal.patch`, MAX_PATCH_BYTES);
    if (patch) {
      const numstat = nulList(git(["apply", "--numstat", "-z", "--"], { input: patch }));
      const paths = numstat.map((line) => {
        const match = /^(?:\d+|-)\t(?:\d+|-)\t(.+)$/.exec(line);
        if (!match) throw new Error("Proposal patch contains an unsupported rename or path");
        return match[1];
      });
      checkPaths(root, paths);
      withIndex(
        git,
        (env) => {
          git(["apply", "--cached", "--binary", "--whitespace=nowarn", "--"], {
            env,
            input: patch,
          });
          const actual = nulList(
            git(
              [
                "diff",
                "--cached",
                "--name-only",
                "--no-renames",
                "--no-ext-diff",
                "--no-textconv",
                "-z",
                "HEAD",
                "--",
              ],
              { env },
            ),
          );
          checkPaths(root, actual);
          checkIndex(git, actual, env);
        },
        temporaryRoot(root, contextEnv),
      );
      git(["apply", "--check", "--binary", "--whitespace=nowarn", "--"], { input: patch });
      git(["apply", "--binary", "--whitespace=nowarn", "--"], { input: patch });
    }
  }
  checkPaths(root, [BASELINE], true);
  writeArtifact(root, BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { baselineOnly: changes.baselineOnly };
}

function githubClient({ env, fetchImpl }) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY || typeof env.GH_TOKEN !== "string" || !env.GH_TOKEN) {
    throw new Error("Publishing requires fleetia/comet and GH_TOKEN");
  }
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

function listPulls(api) {
  return api(
    `/pulls?${new URLSearchParams({ state: "all", head: `fleetia:${BRANCH}`, base: "main", sort: "updated", direction: "desc", per_page: "100" })}`,
  );
}

export function validateExistingProposal(pulls, head, commitEmails, recoverOrphan = false) {
  const branchPulls = pulls.filter(
    (item) => item.head?.repo?.full_name === REPOSITORY && item.head.ref === BRANCH,
  );
  if (!head) return null;
  if (commitEmails.some((emails) => emails !== `${BOT_EMAIL}\t${BOT_EMAIL}`)) {
    throw new Error("Existing proposal branch contains human commits; refusing to overwrite it");
  }
  const pull =
    branchPulls.find((item) => item.state === "open") ??
    branchPulls.find((item) => item.head.sha === head);
  if (
    !pull &&
    recoverOrphan &&
    commitEmails.length === 1 &&
    branchPulls.every(
      (item) => item.user?.login === BOT_NAME && item.state === "closed" && item.merged_at,
    )
  )
    return null;
  if (
    !pull ||
    pull.user?.login !== BOT_NAME ||
    pull.head.sha !== head ||
    (pull.state === "open" ? pull.draft !== true : !pull.merged_at)
  ) {
    throw new Error("Existing proposal branch is not an untouched bot draft or merged bot PR");
  }
  return pull.state === "open" ? pull : null;
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

function quoteModelText(text) {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
  );
}

function pullBody(changes, result) {
  const lines = [
    changes.baselineOnly
      ? "Figma 변경 감지를 시작할 기준 스냅샷을 등록합니다. 기존 코드와 디자인의 일치 여부를 검증한 기준은 아닙니다."
      : "Figma FILE_UPDATE 이후 감지된 컴포넌트 변경을 디자인시스템 코드 변경안으로 준비했습니다.",
    "",
    `[Figma 원본](https://www.figma.com/design/${FILE_KEY})`,
    "",
    `추가 ${changes.added.length}개 · 변경 ${changes.changed.length}개 · 삭제 ${changes.removed.length}개`,
    "",
    "디자인시스템 검사와 테스트를 통과했습니다. 앱 적용·앱 빌드·데스크톱 실행은 포함하지 않습니다.",
    "",
    "현재 Figma Professional 플랜에서는 Variables REST API를 사용할 수 없어, 컴포넌트에 반영된 값과 바인딩을 비교합니다. 사용하지 않는 변수와 모든 모드의 변경은 감지 범위에 포함하지 않습니다.",
  ];
  if (result) {
    lines.push("", "자동 생성 요약:", "", quoteModelText(result.summary));
    if (result.limitations.length)
      lines.push("", "자동 생성기가 보고한 제한:", "", ...result.limitations.map(quoteModelText));
  }
  return lines.join("\n");
}

export async function publish(options = {}) {
  const ctx = context(options);
  const { root, env, git, sha } = ctx;
  const api = githubClient(ctx);
  const { changes, snapshot } = prepared(root);
  if (stableStringify(validateSnapshot(jsonFile(root, BASELINE))) !== stableStringify(snapshot))
    throw new Error("Staged baseline differs from the trusted preparation artifact");
  const result = changes.baselineOnly
    ? null
    : validateResult(jsonFile(root, `${PROPOSAL}/result.json`, 32 * 1024));
  const paths = changedPaths(git);
  checkPaths(root, paths, true);
  if (!paths.includes(BASELINE)) throw new Error("Proposal must update the Figma baseline");
  const auth = gitAuth(env.GH_TOKEN);
  const remote = `https://github.com/${REPOSITORY}.git`;
  const assertRemoteBase = () => {
    const remoteHead = git(["ls-remote", remote, "refs/heads/main"], { env: auth })
      .trim()
      .split(/\s+/)[0];
    if (remoteHead !== sha)
      throw new Error("main advanced; rerun the workflow against the latest main");
  };
  assertRemoteBase();
  git(["add", "-A", "--", ...paths]);
  const staged = nulList(
    git([
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "-z",
      "HEAD",
      "--",
    ]),
  );
  checkPaths(root, staged, true);
  checkIndex(git, staged);
  const [ref, pulls] = await Promise.all([
    api(`/git/ref/heads/${BRANCH}`, { allowMissing: true }),
    listPulls(api),
  ]);
  const existingHead = ref?.object?.sha ?? "";
  let commitEmails = [];
  let recoverOrphan = false;
  if (existingHead) {
    if (!/^[a-f0-9]{40}$/.test(existingHead)) throw new Error("Invalid remote proposal SHA");
    git(["fetch", "--no-tags", remote, `+refs/heads/${BRANCH}:refs/figma/proposal`], { env: auth });
    if (git(["rev-parse", "refs/figma/proposal"]).trim() !== existingHead)
      throw new Error("Proposal branch changed during validation; retry");
    const mergeBase = git(["merge-base", sha, "refs/figma/proposal"]).trim();
    commitEmails = git(["log", "--format=%ae%x09%ce", `${mergeBase}..refs/figma/proposal`])
      .trim()
      .split("\n")
      .filter(Boolean);
    const hasCurrentPull = pulls.some(
      (item) =>
        item.head?.repo?.full_name === REPOSITORY &&
        item.head.ref === BRANCH &&
        (item.state === "open" || item.head.sha === existingHead),
    );
    if (
      !hasCurrentPull &&
      commitEmails.length === 1 &&
      git(["show", "--no-patch", "--format=%P", "refs/figma/proposal"]).trim() === sha &&
      git(["rev-parse", "refs/figma/proposal^{tree}"]).trim() === git(["write-tree"]).trim()
    ) {
      const orphanPaths = nulList(
        git([
          "diff",
          "--name-only",
          "--no-renames",
          "--no-ext-diff",
          "--no-textconv",
          "-z",
          sha,
          "refs/figma/proposal",
          "--",
        ]),
      );
      checkPaths(root, orphanPaths, true);
      for (const item of nulList(
        git(["ls-tree", "-r", "-z", "refs/figma/proposal", "--", ...orphanPaths]),
      )) {
        if (!/^100644 blob [a-f0-9]{40}\t/.test(item))
          throw new Error("Orphan proposal contains non-regular files");
      }
      recoverOrphan = orphanPaths.length > 0;
    }
  }
  const existingPull = validateExistingProposal(pulls, existingHead, commitEmails, recoverOrphan);
  git(
    [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      changes.baselineOnly
        ? "chore: Figma 변경 감지 기준 등록"
        : "feat: Figma 디자인시스템 변경 반영",
    ],
    {
      env: {
        GIT_AUTHOR_NAME: BOT_NAME,
        GIT_AUTHOR_EMAIL: BOT_EMAIL,
        GIT_COMMITTER_NAME: BOT_NAME,
        GIT_COMMITTER_EMAIL: BOT_EMAIL,
      },
    },
  );
  assertRemoteBase();
  git(
    [
      "push",
      `--force-with-lease=refs/heads/${BRANCH}:${existingHead}`,
      remote,
      `HEAD:refs/heads/${BRANCH}`,
    ],
    { env: auth },
  );
  const body = pullBody(changes, result);
  const pull = existingPull
    ? await api(`/pulls/${existingPull.number}`, { method: "PATCH", body: { body } })
    : await api("/pulls", {
        method: "POST",
        body: {
          title: changes.baselineOnly
            ? "chore: Figma 변경 감지 기준 등록"
            : "feat: Figma 디자인시스템 변경 반영",
          head: BRANCH,
          base: "main",
          draft: true,
          body,
        },
      });
  if (
    typeof pull.html_url !== "string" ||
    !/^https:\/\/github\.com\/fleetia\/comet\/pull\/\d+$/.test(pull.html_url)
  )
    throw new Error("GitHub returned an invalid PR URL");
  if (env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, `Figma 디자인시스템 변경안: ${pull.html_url}\n`);
  return { url: pull.html_url };
}

export async function dedupe(options = {}) {
  const ctx = context(options);
  const api = githubClient(ctx);
  const { changes, snapshot } = prepared(ctx.root);
  let changed =
    changes.baselineOnly ||
    changes.added.length + changes.changed.length + changes.removed.length > 0;
  if (changed) {
    const pulls = await listPulls(api);
    const open = pulls.find(
      (pull) =>
        pull.state === "open" &&
        pull.user?.login === BOT_NAME &&
        pull.head?.repo?.full_name === REPOSITORY &&
        pull.head.ref === BRANCH,
    );
    if (open) {
      const content = await api(
        `/contents/${BASELINE}?${new URLSearchParams({ ref: open.head.sha })}`,
        { allowMissing: true },
      );
      if (
        content?.encoding === "base64" &&
        typeof content.content === "string" &&
        content.size <= 2 * 1024 * 1024
      ) {
        const existing = validateSnapshot(
          JSON.parse(Buffer.from(content.content, "base64").toString("utf8")),
        );
        changed = stableStringify(existing) !== stableStringify(snapshot);
      }
    }
  }
  if (ctx.env.GITHUB_OUTPUT) appendFileSync(ctx.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  return { changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const commands = { bundle, apply, publish, dedupe };
  try {
    if (process.argv.length !== 3 || !Object.hasOwn(commands, process.argv[2]))
      throw new Error("Usage: node ds/scripts/figma-proposal.mjs bundle|apply|publish|dedupe");
    console.log(JSON.stringify(await commands[process.argv[2]]()));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
