import { expect, it, vi } from "vitest";
import { prepareRelease } from "./prepare-release.mjs";

const repository = { owner: "fleetia", repo: "comet" };
const missing = Object.assign(new Error("Not Found"), { status: 404 });

function githubFixture() {
  return {
    rest: {
      repos: {
        getReleaseByTag: vi.fn().mockRejectedValue(missing),
        getCommit: vi.fn().mockResolvedValue({ data: { sha: "release-commit" } }),
      },
      git: {
        getRef: vi.fn().mockRejectedValue(missing),
        createRef: vi.fn().mockResolvedValue({}),
      },
    },
  };
}

it("creates a version tag at the verified commit before invoking desktop release", async () => {
  const github = githubFixture();
  await expect(prepareRelease(github, repository, "0.4.1", "release-commit")).resolves.toBe(
    "v0.4.1",
  );
  expect(github.rest.git.createRef).toHaveBeenCalledWith({
    ...repository,
    ref: "refs/tags/v0.4.1",
    sha: "release-commit",
  });
});

it("skips an already published version on subsequent main commits", async () => {
  const github = githubFixture();
  github.rest.repos.getReleaseByTag.mockResolvedValue({ data: { draft: false } });
  await expect(prepareRelease(github, repository, "0.4.1", "docs-commit")).resolves.toBe("");
  expect(github.rest.git.createRef).not.toHaveBeenCalled();
});

it("reuses an interrupted draft at the same commit without moving its tag", async () => {
  const github = githubFixture();
  github.rest.repos.getReleaseByTag.mockResolvedValue({ data: { draft: true } });
  github.rest.git.getRef.mockResolvedValue({ data: {} });
  await expect(prepareRelease(github, repository, "0.4.1", "release-commit")).resolves.toBe(
    "v0.4.1",
  );
  expect(github.rest.git.createRef).not.toHaveBeenCalled();
});

it("refuses to retarget an existing version tag", async () => {
  const github = githubFixture();
  github.rest.git.getRef.mockResolvedValue({ data: {} });
  await expect(prepareRelease(github, repository, "0.4.1", "other-commit")).rejects.toThrow(
    "another commit",
  );
  expect(github.rest.git.createRef).not.toHaveBeenCalled();
});

it("does not mistake GitHub permission or network failures for a missing release", async () => {
  const github = githubFixture();
  github.rest.repos.getReleaseByTag.mockRejectedValue(
    Object.assign(new Error("Forbidden"), { status: 403 }),
  );
  await expect(prepareRelease(github, repository, "0.4.1", "release-commit")).rejects.toThrow(
    "Forbidden",
  );
  expect(github.rest.git.createRef).not.toHaveBeenCalled();
});
