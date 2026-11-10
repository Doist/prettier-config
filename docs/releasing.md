# Publishing `@todoist/prettier-config`

These are maintainer instructions for real releases after review and the GitHub organization rename. Preparing this change does not authorize executing publication, workflow dispatch, tags, or settings changes.

## Release policy and bootstrap

The existing policy is manual semantic versioning, a version commit, a `v<version>` tag, and a changelog entry. There is no semantic-release calculation. The migration selects the next patch, **4.0.1 → 4.0.2**, for the new name. Existing `@doist` releases and tags remain untouched. Recheck both target registries for collisions immediately before release; never overwrite an existing version.

Publication is now an explicit second action: tags run **pack.yml only**, and **publish.yml** publishes its retained artifact when a maintainer dispatches it. Branch pushes, pull requests, and merging this PR do not publish. Neither workflow calls a shared Doist/Todoist action or requires another new-scope package.

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

The tag starts the non-publishing `pack.yml` workflow. Its artifact `prettier-config-4.0.2` contains `todoist-prettier-config-4.0.2.tgz` and `release.json` (source SHA/ref, version, SHA-512 integrity, SHA-1 checksum). The workflow validates tag/version equality. A controlled alternative is `gh workflow run pack.yml --repo todoist/prettier-config --ref main`; select one source run, not a replacement build for a retry.

Inspect the successful pack run and its commit. Keep its numeric run ID as `PACK_RUN_ID` and the matching commit as `RELEASE_SHA`. Download to a dedicated directory outside any checkout:

```sh
RELEASE_DIR=$(mktemp -d)
gh run download "$PACK_RUN_ID" --repo todoist/prettier-config \
  --name prettier-config-4.0.2 --dir "$RELEASE_DIR"
node .github/scripts/release.mjs verify "$RELEASE_DIR" "$RELEASE_SHA" 4.0.2
```

Run the verifier from the reviewed checkout. Back up the **original downloaded tarball and release.json**, plus run URL/ID, before the Actions artifact expires (90 days or the organization retention limit). Do not repack for a missing mirror. If the source artifact expires, restore the exact retained bytes for authorized manual recovery; do not create a replacement artifact run.

## First real npm publication: interactive, then exact GitHub mirror

The authorized maintainer uses Node 24 and npm 11.21.2. Use the downloaded archive, a dedicated working directory, and isolated npm configuration. The verifier rejects any packed `publishConfig` (including registry/access/tag overrides). The explicit `@todoist` mapping below prevents user/project scope mappings from overriding the target; **`--registry` alone is insufficient**.

```sh
cd "$RELEASE_DIR"
# Use a Bash release shell; discard inherited npm config/auth overrides.
while IFS='=' read -r key _; do
  case "$key" in npm_config_*|NPM_CONFIG_*|NPM_TOKEN|NODE_AUTH_TOKEN) unset "$key" ;; esac
done < <(env)
export NPM_CONFIG_USERCONFIG="$RELEASE_DIR/npm-user.npmrc"
export NPM_CONFIG_GLOBALCONFIG="$RELEASE_DIR/npm-global.npmrc"
: > "$NPM_CONFIG_GLOBALCONFIG"
printf 'registry=https://registry.npmjs.org/\n@todoist:registry=https://registry.npmjs.org/\n' > "$NPM_CONFIG_USERCONFIG"
chmod 600 "$NPM_CONFIG_USERCONFIG"
npm login --registry=https://registry.npmjs.org/
npm config get @todoist:registry # must be https://registry.npmjs.org/
npm publish "$RELEASE_DIR/todoist-prettier-config-4.0.2.tgz" \
  --registry=https://registry.npmjs.org/ --access=public --tag=latest --ignore-scripts --provenance=false
npm view @todoist/prettier-config@4.0.2 dist --json --registry=https://registry.npmjs.org/
```

Verify `dist.integrity` equals `release.json.integrity`. No placeholder, staged release, provenance claim for the local manual publish, or extra version is needed. Treat the login file as a secret, outside the repository and artifact backups; remove it when finished.

Then dispatch **only the GitHub destination** using the original source run:

```sh
gh workflow run publish.yml --repo todoist/prettier-config --ref main \
  -f source_run_id="$PACK_RUN_ID" -f version=4.0.2 -f destination=github
```

Approve the protected environment. This route neither calls npm publication nor assumes npm trust. It downloads the original tarball, checks its source against a successful same-repository `pack.yml` run on reviewed main history, validates packed identity/routing and checksums, and publishes only a missing version. A matching existing version is verified and skipped; different bytes or lookup errors stop the job. npm/GitHub config and credentials are separated in temporary directories. Set/verify the GitHub mirror's intended public visibility and repository grants independently.

## Later releases and recovery

Update `CHANGELOG.md` and use the existing `npm version <major|minor|patch>` process on a release branch. Merge the version commit through normal review and branch protections before pushing its matching tag; the publisher requires the artifact commit to be on main history. Tags only pack. After the new npm package exists and trust is configured, publish the selected successful pack run:

```sh
gh workflow run publish.yml --repo todoist/prettier-config --ref main \
  -f source_run_id="$PACK_RUN_ID" -f version="$VERSION" -f destination=both
```

Use `destination=npm` or `destination=github` with the **same run ID and version** for a missing mirror. Never bump versions, retag, rerun the pack job, or rebuild to recover a partial publish. `both` also skips matching completed destinations. An error after registry acceptance can be retried this way; the next lookup verifies it. The workflow serializes publications and never overwrites versions. The existing-version check does not move dist-tags. Before publishing a missing version under `latest`, the script rejects a newer current `latest` instead of downgrading it. For an older missing mirror, keep the same artifact/version and explicitly select `-f dist_tag=recovery` in the dispatch command; this publishes under the `recovery` tag and leaves `latest` untouched. Record the temporary recovery tag and verify both tags afterwards. The equivalent local script command ends with `github recovery` (or use `--tag=recovery` in the isolated interactive npm command). Never use the manual `--tag=latest` command for an older version. Removing an unneeded recovery tag is a separate maintainer action; OIDC dist-tag management would require its separate permission.

If the Actions artifact has expired, use the backed-up original files. From the reviewed checkout, verify them again with `release.mjs verify`. The npm maintainer can use the isolated interactive npm procedure above for a missing npm copy. For a missing GitHub copy, export an authorized PAT (classic) as `NODE_AUTH_TOKEN` with `write:packages` and repository package rights, then run `node .github/scripts/release.mjs publish "$RELEASE_DIR" "$RELEASE_SHA" "$VERSION" github`. The script isolates registry config, verifies the same files, and skips an identical completed copy. Do not expose the token or change global npm configuration.

## Consumer gate and safe source checks

A successful producer merge or pack is not a release. Record both registry versions, integrity/checksums, `latest` tags, visibility, and successful fresh installs using each consumer's actual credentials/routing. Public-only consumers may use npmjs; mixed/private consumers route `@todoist` to GitHub Packages with explicit access. Use disposable directories, `--ignore-scripts --no-audit --no-fund`, explicit scope mappings, and exact `@todoist/prettier-config@4.0.2`. Never fabricate consumer lockfile integrity. Consumers can advance only after both registry copies and access are verified.

Safe preparation checks in this repository are `npm ci --ignore-scripts --no-audit --no-fund`, `node --test .github/scripts/release.test.mjs`, local pack/verification into a temporary directory, and `git diff --check`. The test runner stubs publication and registry responses; it never publishes, stages, or contacts a registry. A local source-level pack is not the real release artifact or a cutover rehearsal.
