export async function prepareRelease(github, repository, version, sha) {
  const tag = `v${version}`;
  try {
    const { data: release } = await github.rest.repos.getReleaseByTag({ ...repository, tag });
    if (!release.draft) {
      return "";
    }
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  let existingTag;
  try {
    existingTag = await github.rest.git.getRef({ ...repository, ref: `tags/${tag}` });
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }

  if (existingTag) {
    const { data: commit } = await github.rest.repos.getCommit({ ...repository, ref: tag });
    if (commit.sha !== sha) {
      throw new Error(
        `${tag} points to another commit; retry Release desktop with this existing tag`,
      );
    }
  } else {
    await github.rest.git.createRef({ ...repository, ref: `refs/tags/${tag}`, sha });
  }
  return tag;
}
