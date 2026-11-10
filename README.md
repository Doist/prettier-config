# `@todoist/prettier-config`

> Doist global [prettier](https://prettier.io) config.

## Usage

**Install**:

```sh
npm install --save-dev @todoist/prettier-config
```

**Edit `package.json`**:

```jsonc
{
    // ...
    "prettier": "@todoist/prettier-config"
}
```

## Release a new package

This project uses [semantic versioning](https://semver.org/), explicit version commits, and `v<version>` tags. Add an entry to [CHANGELOG.md](CHANGELOG.md) for each release.

Tags now **pack only**. An authorized maintainer publishes the retained tarball to npm and GitHub Packages through a separate manual workflow. Both registries receive the same artifact and version; retries never bump a version or repack it.

Follow the [release runbook](https://github.com/todoist/prettier-config/blob/main/docs/releasing.md) for the first real `@todoist/prettier-config@4.0.2` publication, npm trusted-publisher setup, and subsequent releases. The package has no build step or migrated toolchain dependency; `.prettierrc.js` reads the local configuration directly.
