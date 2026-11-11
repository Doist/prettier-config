# Publishing `@todoist/prettier-config`

These are maintainer instructions for real releases after review and the GitHub organization rename. Preparing this change does not authorize executing publication, workflow dispatch, tags, or settings changes.

## Release policy and bootstrap

The existing policy is manual semantic versioning, a version commit, a `v<version>` tag, and a changelog entry. There is no semantic-release calculation. The migration selects the next patch, **4.0.1 → 4.0.2**, for the new name. Existing `@doist` releases and tags remain untouched. Recheck both target registries for collisions immediately before release; never overwrite an existing version.

Only run attempt **1** may pack; later reruns are skipped and never replace its archive. Publication is now an explicit second action: tags run **pack.yml only**, and **publish.yml** publishes its retained artifact when a maintainer dispatches it. Branch pushes, pull requests, and merging this PR do not publish. Neither workflow calls a shared Doist/Todoist action or requires another new-scope package.

There is no build: `index.json` is the distribution. `pack.yml` runs `npm pack --ignore-scripts` without installing dependencies. The packed manifest has no `publishConfig`, lifecycle scripts, runtime, optional, or development dependencies. The sole peer is the existing public `prettier@^3.0.0`; the lock retains `prettier@3.0.1`. Formatting uses the local `.prettierrc.js` and does not install this package itself.

## Settings and rights

| Setting                  | Required value / action                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source repository        | `todoist/prettier-config`, public; rename and merge reviewed source first                                                                                |
| Artifact producer        | `.github/workflows/pack.yml`; tag `v<version>` or manual dispatch on `main`; `contents: read` only                                                       |
| Publisher and npm caller | `.github/workflows/publish.yml`, filename **`publish.yml`**; no reusable caller                                                                          |
| Runner / runtime         | GitHub-hosted `ubuntu-latest`, Node `24`, npm **`11.21.2`**                                                                                              |
| Environment              | **`package-release`**; create with required maintainer approval and only `main` allowed before publishing                                                |
| Publisher permissions    | `contents: read`, `actions: read`, `id-token: write`, `packages: write`                                                                                  |
| npm first publication    | Authorized `todoist` npm maintainer, interactive login/2FA, public access, exact real tarball                                                            |
| Subsequent npm auth      | Trusted publisher: owner `todoist`, repo `prettier-config`, workflow `publish.yml`, environment `package-release`; explicitly allow direct `npm publish` |
| GitHub auth              | `GITHUB_TOKEN` for the repository-linked mirror; grant this repository package Write if not inherited                                                    |
| GitHub visibility        | Existing mirror is **public** (checked before rename); inspect transferred/new mirror and preserve public separately from npm access                     |
| Consumer access          | Grant required consuming repositories Read in Manage Actions access; local GitHub installs need authentication even for a public mirror                  |

Administrative links (future owner URLs may not exist until rename):

-   [Repository Actions settings](https://github.com/todoist/prettier-config/settings/actions) and [environments](https://github.com/todoist/prettier-config/settings/environments).
-   [npm package access/trusted publishing](https://www.npmjs.com/package/@todoist/prettier-config/access).
-   [GitHub mirror settings](https://github.com/orgs/todoist/packages/npm/prettier-config/settings) and [package page](https://github.com/orgs/todoist/packages/npm/prettier-config).

A new npm identity must exist before configuring trust. Configure trust near the next real automated release: new connections expire after two days without a successful publication. A prior interactive release does not verify a later OIDC connection. This workflow uses direct publish and needs no separate dist-tag management permission. This cross-run publisher explicitly disables npm provenance (`--provenance=false`, including automatic OIDC provenance): the publisher commit may differ from the retained artifact’s build commit. Source run/SHA and archive checksums remain in `release.json`. GitHub visibility is not set by the npm access flag. See [npm trust prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [trusted publishing](https://docs.npmjs.com/trusted-publishers/), and [GitHub npm registry permissions](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## First real release: prepare one artifact

Henning routes these steps to the existing package maintainer; no separate owner assignment was available during preparation. Confirm the rename, reviewed merge, protected `package-release` environment, and registry rights. Confirm `@todoist/prettier-config@4.0.2` is absent or investigate an existing exact artifact before proceeding. GitHub may transfer the old mirror on rename; check its version inventory again.

For the first release, the version bump is already committed. **Do not run `npm version patch` again.** Fetch the reviewed main, record its SHA, and create only the new version tag using the usual signed/approved repository process:

```sh
git fetch origin main
git switch main
git pull --ff-only
RELEASE_SHA=$(git rev-parse HEAD)
node -p "require('./package.json').version" # must be 4.0.2
git tag -a v4.0.2 "$RELEASE_SHA" -m '4.0.2'
git push origin refs/tags/v4.0.2
```

The tag starts the non-publishing `pack.yml` workflow, whose first attempt must succeed. Its artifact `prettier-config-4.0.2` contains `todoist-prettier-config-4.0.2.tgz` and `release.json` (schema 1, original run ID/attempt 1, checked-out SHA/ref, version, SHA-512 integrity, SHA-1 checksum). The workflow validates tag/version equality. A controlled alternative is `gh workflow run pack.yml --repo todoist/prettier-config --ref main`; select one source run, not a replacement build for a retry.

Inspect the **original** attempt at `https://github.com/todoist/prettier-config/actions/runs/RUN_ID/attempts/1`; a later failed/skipped rerun must not replace its successful evidence. Keep the original numeric run ID as `PACK_RUN_ID`, its artifact ID as `PACK_ARTIFACT_ID`, and its checkout SHA as `RELEASE_SHA`. List artifact IDs read-only with `gh api "repos/todoist/prettier-config/actions/runs/$PACK_RUN_ID/artifacts" --jq '.artifacts[] | {id,name,digest,created_at,workflow_run}'`; choose the original `prettier-config-4.0.2` artifact. The verifier rejects an artifact from another run, checkout or attempt time window.

Run the following local commands in a **Bash terminal**, with Node 24, npm 11.21.2 and `unzip` available. Download through the shared authoritative-source helper, which validates the historical attempt/workflow path/event/repository, reviewed-main ancestry, original successful pack job, exact artifact ID and GitHub's archive SHA-256 digest. It does **not** compare historical workflow bytes to evolving main. The producer checks `git rev-parse HEAD == GITHUB_SHA` before packing. The helper binds schema/run/attempt/SHA metadata and the extracted tarball/release.json bytes to the verified original ZIP.

```sh
RELEASE_DIR=$(mktemp -d)
(
set -e
IFS= read -r -s -p 'GitHub source API token (Actions:read, Contents:read): ' GH_TOKEN
printf '\n'
export GH_TOKEN SOURCE_RUN_ID="$PACK_RUN_ID" SOURCE_ARTIFACT_ID="$PACK_ARTIFACT_ID"
node .github/scripts/source.mjs fetch "$RELEASE_DIR" 4.0.2
)
# Use the authoritative sourceSha printed by fetch as RELEASE_SHA.
node .github/scripts/release.mjs verify "$RELEASE_DIR" "$RELEASE_SHA" 4.0.2
```

`GH_TOKEN` must read Actions artifacts/attempts and repository contents for `todoist/prettier-config`; a fine-grained token with **Actions: read** and **Contents: read** is sufficient. A suitably authorized existing classic token is also usable. Source API credentials are distinct from npm authentication and are stripped from npm subprocesses. Signed archive storage downloads receive no GitHub token.

Back up **source.zip**, the exact `.tgz` and `release.json`, and the original run/artifact IDs before the Actions archive expires (90 days or the organization retention limit). Every bootstrap/publish invocation independently rechecks the original attempt and artifact API digest and compares local entries with source.zip. Local self-consistent checksums alone are insufficient. A backup remains usable only while authoritative original-run/artifact metadata is readable. If that evidence is unavailable or the source schema is unsupported, stop and retain the original bytes for separately approved source-evidence recovery; never repack or invent another archive for an immutable published version.

## First real npm publication: interactive, then exact GitHub mirror

The authorized maintainer uses Node 24 and npm 11.21.2. Before **every** publication, the shared publisher checks existing copies of the exact version in **both** required registries against the retained archive. Any different bytes, missing checksum, malformed response, or authentication/network error stops the operation before a package write. An existing matching copy is skipped; genuine absent copies may be published only to the selected destination. This applies even to an npm-only or GitHub-only retry and to the interactive bootstrap below.

The bootstrap requires independent npm, GitHub Packages, and source-API authentication:

-   npm: an authorized `todoist` scope maintainer logs in interactively and can complete fresh 2FA during publication.
-   GitHub Packages: supply a PAT (classic) as `NODE_AUTH_TOKEN`, with `read:packages`, the account's Read access to the known transferred package (including private mirrors), and any required organization SSO authorization. Before treating an exact-version 404 as absent, the helper must read well-formed, nonempty package dist-tags from the **GitHub npm registry itself**. A package-root 404 or malformed metadata stops every destination before writing. REST visibility, npm whoami and documentation-only confirmation cannot bypass this gate. Restore the known mirror's registry readability. The only exception is the explicit, local, artifact-bound first-namespace operation below; ordinary workflow retries have no absence override.
-   Source API: provide `GH_TOKEN` with Actions:read and Contents:read for the repository, plus `SOURCE_RUN_ID` and `SOURCE_ARTIFACT_ID` naming the original retained archive. Both workflow and local publication independently revalidate it before any package write. A single classic token with all required rights can serve both GitHub purposes, but npm subprocesses receive neither GitHub credential.

In Actions, `GITHUB_TOKEN` is provided for this same cross-registry preflight even for an npm-only destination. Confirm the publishing repository has Read access to an existing/transferred GitHub package in Manage Actions access; its GitHub publication also needs Write. Public npm metadata reads need no npm credentials. Explicit authentication failures and malformed/network responses fail closed.

Run this from the reviewed checkout in a Bash terminal after downloading and verifying the original artifact. The helper creates temporary, isolated user/global npmrc files and a dedicated working directory; it explicitly maps `@todoist` to each registry and strips inherited npm configuration and GitHub tokens from the npm login/publish subprocesses. Login credentials stay in the temporary npm config for publication and are removed afterwards. Both login and **npm publish itself inherit the terminal**, so fresh publication 2FA can be completed. Metadata responses remain captured for checks. The packed `publishConfig` verifier and existing `latest` guard still apply.

```sh
(
set -e
IFS= read -r -s -p 'GitHub source API token (Actions:read, Contents:read): ' GH_TOKEN
printf '\n'
export GH_TOKEN SOURCE_RUN_ID="$PACK_RUN_ID" SOURCE_ARTIFACT_ID="$PACK_ARTIFACT_ID"
# Enter an authorized GitHub read:packages token without echoing or writing it to disk.
IFS= read -r -s -p 'GitHub Packages read token: ' NODE_AUTH_TOKEN
printf '\n'
export NODE_AUTH_TOKEN
node .github/scripts/release.mjs bootstrap "$RELEASE_DIR" "$RELEASE_SHA" 4.0.2 latest
) # The token leaves scope even if bootstrap fails.
```

The bootstrap logs in to npm, rechecks both registries, and publishes only a missing npm copy using the retained tarball, `--access=public --ignore-scripts --provenance=false` and the approved tag. Do not replace it with a raw `npm publish`: that would bypass the mandatory opposite-registry check. No placeholder, staged release, or extra version is needed. Do not run another publisher concurrently, including manual publication outside workflow concurrency control.

### When the old GitHub namespace did not transfer

A repository transfer can leave `@doist/prettier-config` readable while `@todoist/prettier-config` does not yet exist. A new-scope 404 alone is ambiguous. Before any first-namespace write, obtain an explicit organization/package owner confirmation that the new GitHub package is absent for this exact retained run, artifact ID and archive digest. Record the owner and confirmation with the release evidence; do not infer it from a filtered inventory, REST 404 or successful whoami.

Only for that approved local operation, set the following value in the bootstrap subshell (all IDs and the SHA-256 digest come from the authoritative source helper):

```sh
export CONFIRMED_ABSENT_GITHUB_PACKAGE="@todoist/prettier-config@4.0.2:npm:$PACK_RUN_ID:$PACK_ARTIFACT_ID:$ARCHIVE_DIGEST"
# Run the bootstrap command above with the same source IDs and credentials.
```

For the first GitHub mirror, use a separate local operation authorized by the same owner for the same original bytes. Set the confirmation destination to `github`, provide a classic PAT with `read:packages` and `write:packages` plus actual organization/package access as `NODE_AUTH_TOKEN`, and retain the source API token and IDs:

```sh
export CONFIRMED_ABSENT_GITHUB_PACKAGE="@todoist/prettier-config@4.0.2:github:$PACK_RUN_ID:$PACK_ARTIFACT_ID:$ARCHIVE_DIGEST"
node .github/scripts/release.mjs publish "$RELEASE_DIR" "$RELEASE_SHA" 4.0.2 github latest
```

The helper rejects this confirmation in Actions or for a different destination/archive, requires successful registry authentication, and still checks both exact-version copies before every write. Malformed metadata, auth/network errors, contradictory root/version evidence and differing existing bytes stop publication. Once the new mirror exists, its registry metadata must be readable and every matching copy must agree; the confirmation never permits overriding an existing version. Unset the confirmation afterwards. Preserve the old namespace and independently set/verify the new GitHub mirror **public**; npm public access does not set GitHub visibility. Local publication does not require configuring the future protected environment or npm OIDC first.

Then dispatch **only the GitHub destination** using the original source run:

```sh
gh workflow run publish.yml --repo todoist/prettier-config --ref main \
  -f source_run_id="$PACK_RUN_ID" -f source_artifact_id="$PACK_ARTIFACT_ID" -f version=4.0.2 -f destination=github
```

Approve the protected environment. This route neither calls npm publication nor assumes npm trust. It downloads the original tarball, checks its source against a successful same-repository `pack.yml` run on reviewed main history, validates packed identity/routing and checksums, and publishes only a missing version. Before the selected destination writes, matching copies in both registries are verified, different bytes or lookup errors in either registry stop the job, and an already completed matching destination is skipped. npm/GitHub config and credentials are separated in temporary directories. Set/verify the GitHub mirror's intended public visibility and repository grants independently.

## Later releases and recovery

Update `CHANGELOG.md` and use the existing `npm version <major|minor|patch>` process on a release branch. Merge the version commit through normal review and branch protections before pushing its matching tag; the publisher requires the artifact commit to be on main history. Tags only pack. After the new npm package exists and trust is configured, publish the selected successful pack run:

```sh
gh workflow run publish.yml --repo todoist/prettier-config --ref main \
  -f source_run_id="$PACK_RUN_ID" -f source_artifact_id="$PACK_ARTIFACT_ID" -f version="$VERSION" -f destination=both
```

Use `destination=npm` or `destination=github` with the **same run ID, artifact ID and version** for a missing mirror. Never bump versions, retag, rerun the pack job, or rebuild to recover a partial publish. `both` also skips matching completed destinations. An error after registry acceptance can be retried this way; the next lookup verifies it. The workflow serializes publications and never overwrites versions. The existing-version check does not move dist-tags. Before publishing a missing version under `latest`, the script rejects a newer current `latest` instead of downgrading it. For an older missing mirror, keep the same artifact/version and explicitly select `-f dist_tag=recovery` in the dispatch command; this publishes under the `recovery` tag and leaves `latest` untouched. Record the temporary recovery tag and verify both tags afterwards. The equivalent local script command ends with `github recovery` (or end the interactive `bootstrap` command with `recovery`). The bootstrap shares the same latest guard; never bypass it with a raw publication command. Removing an unneeded recovery tag is a separate maintainer action; OIDC dist-tag management would require its separate permission.

If the Actions archive has expired but its original API metadata remains readable, use the backed-up original source.zip, tarball and release.json with the same run/artifact IDs. From the reviewed checkout, verify them again with `release.mjs verify`. The npm maintainer must use the `bootstrap` command above for a missing npm copy, with the same source-API credentials/IDs, GitHub package read token and two-registry preflight. For a missing GitHub copy, retain the same GH_TOKEN/SOURCE_RUN_ID/SOURCE_ARTIFACT_ID setup and export an authorized PAT (classic) as `NODE_AUTH_TOKEN` with `read:packages` and `write:packages`, intended package Read/Write access, and any required SSO authorization, then run `node .github/scripts/release.mjs publish "$RELEASE_DIR" "$RELEASE_SHA" "$VERSION" github`. The script isolates registry config, binds the same local files to authoritative original archive evidence and checks both registry copies before writing, and skips an identical completed copy. Do not expose the token or change global npm configuration.

## Consumer gate and safe source checks

A successful producer merge or pack is not a release. Record both registry versions, integrity/checksums, `latest` tags, visibility, and successful fresh installs using each consumer's actual credentials/routing. Public-only consumers may use npmjs; mixed/private consumers route `@todoist` to GitHub Packages with explicit access. Use disposable directories, `--ignore-scripts --no-audit --no-fund`, explicit scope mappings, and exact `@todoist/prettier-config@4.0.2`. Never fabricate consumer lockfile integrity. Consumers can advance only after both registry copies and access are verified.

Safe preparation checks in this repository are `npm ci --ignore-scripts --no-audit --no-fund`, `node --test .github/scripts/release.test.mjs`, local pack/verification into a temporary directory, and `git diff --check`. The test runner stubs publication and registry responses; it never publishes, stages, or contacts a registry. A local source-level pack is not the real release artifact or a cutover rehearsal.
