import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySource } from './source.mjs'

const packageName = '@todoist/prettier-config'
const repository = 'https://github.com/todoist/prettier-config'
const registries = { npm: 'https://registry.npmjs.org/', github: 'https://npm.pkg.github.com/' }
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hash = (bytes, algorithm, encoding) => createHash(algorithm).update(bytes).digest(encoding)

function validatePackage(pkg, version) {
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Only stable semver releases are supported')
    assert.equal(pkg.name, packageName)
    assert.equal(pkg.version, version)
    assert.equal(pkg.repository, repository)
    assert.ok(!pkg.private, 'The npm package must remain public')
    assert.equal(pkg.publishConfig, undefined, 'Packed publishConfig must not override routing')
    assert.equal(pkg.scripts, undefined, 'This leaf package needs no lifecycle scripts')
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        assert.equal(Object.keys(pkg[key] ?? {}).length, 0, `Unexpected ${key}`)
    }
    assert.deepEqual(pkg.peerDependencies, { prettier: '^3.0.0' })
    assert.equal(pkg.main, 'index.json')
}

export function verify(directory, sourceSha, version) {
    assert.match(version, /^\d+\.\d+\.\d+$/, 'Only stable semver releases are supported')
    assert.match(sourceSha, /^[a-f0-9]{40}$/)
    const release = json(join(directory, 'release.json'))
    assert.equal(release.name, packageName)
    assert.equal(release.version, version)
    assert.equal(release.sourceSha, sourceSha)
    assert.equal(release.filename, `todoist-prettier-config-${version}.tgz`)
    const tarball = resolve(directory, release.filename)
    const bytes = readFileSync(tarball)
    assert.equal(release.integrity, `sha512-${hash(bytes, 'sha512', 'base64')}`)
    assert.equal(release.shasum, hash(bytes, 'sha1', 'hex'))
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n')
    assert.deepEqual(
        files.sort(),
        [
            'package/CHANGELOG.md',
            'package/README.md',
            'package/index.json',
            'package/package.json',
        ].sort(),
        'Unexpected packed files',
    )
    const pkg = JSON.parse(
        execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    )
    validatePackage(pkg, version)
    return { ...release, tarball }
}

export function pack(directory, sourceSha, sourceRef) {
    const pkg = json('package.json')
    validatePackage(pkg, pkg.version)
    assert.match(sourceSha, /^[a-f0-9]{40}$/)
    assert.ok(
        sourceRef === 'refs/heads/main' || sourceRef === `refs/tags/v${pkg.version}`,
        'Use main or the matching version tag',
    )
    const lock = json('package-lock.json')
    for (const entry of [lock, lock.packages['']]) {
        assert.equal(entry.name, pkg.name)
        assert.equal(entry.version, pkg.version)
    }
    if (process.env.GITHUB_RUN_ID)
        assert.equal(
            process.env.GITHUB_RUN_ATTEMPT,
            '1',
            'Only the original pack attempt may produce a release artifact',
        )
    mkdirSync(directory, { recursive: true })
    const [packed] = JSON.parse(
        execFileSync(
            'npm',
            ['pack', '--ignore-scripts', '--json', '--pack-destination', resolve(directory)],
            { encoding: 'utf8' },
        ),
    )
    const release = {
        schema: 1,
        sourceRunId: process.env.GITHUB_RUN_ID ?? null,
        sourceRunAttempt: process.env.GITHUB_RUN_ID ? 1 : null,
        name: pkg.name,
        version: pkg.version,
        sourceSha,
        sourceRef,
        filename: packed.filename,
        integrity: packed.integrity,
        shasum: packed.shasum,
    }
    writeFileSync(join(directory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`)
    verify(directory, sourceSha, pkg.version)
    return release
}

// A temporary cwd and explicit scope mapping prevent project/user npmrc routing leaks.
// Never log config contents or token values. npm uses OIDC for npmjs, GITHUB_TOKEN for GitHub.
export function withRegistry(destination, callback, spawn = spawnSync) {
    assert.ok(Object.hasOwn(registries, destination), 'Unknown registry')
    if (destination === 'github')
        assert.ok(process.env.NODE_AUTH_TOKEN, 'GitHub package token is required')
    const registry = registries[destination]
    const directory = mkdtempSync(join(tmpdir(), 'prettier-config-publish-'))
    const env = Object.fromEntries(
        Object.entries(process.env).filter(
            ([key]) =>
                !/^(npm_config_|npm_token$|node_auth_token$|github_token$|gh_token$|gh_packages_token$|confirmed_absent_github_package$)/i.test(
                    key,
                ),
        ),
    )
    env.NPM_CONFIG_USERCONFIG = join(directory, 'user.npmrc')
    env.NPM_CONFIG_GLOBALCONFIG = join(directory, 'global.npmrc')
    writeFileSync(env.NPM_CONFIG_GLOBALCONFIG, '')
    let config = `registry=${registry}\n@todoist:registry=${registry}\n`
    if (destination === 'github') {
        env.NODE_AUTH_TOKEN = process.env.NODE_AUTH_TOKEN
        config += '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n'
    }
    writeFileSync(env.NPM_CONFIG_USERCONFIG, config, { mode: 0o600 })
    try {
        return callback(
            (args, options = {}) =>
                spawn('npm', args, { cwd: directory, env, encoding: 'utf8', ...options }),
            registry,
        )
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

export function registryMetadata(run, registry, spec, field = 'dist') {
    // An explicit range reads tags without resolving latest (npm treats bare * as latest).
    const result = run([
        'view',
        field === 'dist-tags' ? `${spec}@>=0` : spec,
        field,
        '--json',
        `--registry=${registry}`,
    ])
    if (result.status === 0) {
        let value = JSON.parse(result.stdout)
        if (field === 'dist-tags' && Array.isArray(value)) {
            assert.ok(value.length > 0, 'Ambiguous registry metadata')
            for (const tags of value) assert.deepEqual(tags, value[0], 'Inconsistent registry tags')
            value = value[0]
        }
        assert.ok(
            value && typeof value === 'object' && !Array.isArray(value),
            'Ambiguous registry metadata',
        )
        return value
    }
    // Authentication, networking and other failures must not be mistaken for absence.
    const errors = []
    for (const stream of [result.stdout, result.stderr]) {
        try {
            const error = JSON.parse(stream).error
            if (error) errors.push(error)
        } catch {
            /* npm can emit non-JSON diagnostics alongside its structured error */
        }
    }
    if (errors.length && errors.every((error) => error.code === 'E404')) return null
    throw new Error(`Registry lookup failed: ${result.stderr || result.error || result.stdout}`)
}

export function assertSameArtifact(dist, release) {
    assert.ok(dist, 'Published version is missing')
    if (dist.integrity)
        assert.equal(
            dist.integrity,
            release.integrity,
            'Registry integrity differs; do not overwrite or bump',
        )
    else
        assert.equal(
            dist.shasum,
            release.shasum,
            'Registry checksum differs; do not overwrite or bump',
        )
}

// Both required registries must agree with the retained bytes before any destination writes.
export function preflight(release, lookup) {
    for (const destination of Object.keys(registries)) {
        const existing = lookup(destination)
        if (existing !== null) assertSameArtifact(existing, release)
    }
}

export function ownerConfirmedAbsence(release, destination, env = process.env) {
    const confirmation = env.CONFIRMED_ABSENT_GITHUB_PACKAGE
    if (!confirmation) return false
    assert.notEqual(env.GITHUB_ACTIONS, 'true', 'First namespace confirmation is local only')
    assert.ok(['npm', 'github'].includes(destination))
    assert.match(release.sourceRunId ?? '', /^[1-9]\d*$/)
    assert.match(release.sourceArtifactId ?? '', /^[1-9]\d*$/)
    assert.match(release.sourceArchiveDigest ?? '', /^sha256:[a-f0-9]{64}$/)
    assert.equal(
        confirmation,
        `${release.name}@${release.version}:${destination}:${release.sourceRunId}:${release.sourceArtifactId}:${release.sourceArchiveDigest}`,
        'Owner absence confirmation must bind this destination and authoritative original artifact',
    )
    return true
}

export function lookupCopy(release, destination, connect = withRegistry, confirmedAbsent = false) {
    return connect(destination, (run, registry) => {
        if (destination === 'github') {
            // Normal retries require registry readability. The old @doist package can stay
            // behind during a repository transfer; only an owner-confirmed local first
            // namespace operation may interpret the new package's root404 as absence.
            const tags = registryMetadata(run, registry, release.name, 'dist-tags')
            if (tags === null && confirmedAbsent) {
                const identity = run(['whoami', '--json', `--registry=${registry}`])
                assert.equal(identity.status, 0, 'GitHub package credentials must authenticate')
                const username = JSON.parse(identity.stdout)
                assert.ok(typeof username === 'string' && username.length > 0)
                const existing = registryMetadata(
                    run,
                    registry,
                    `${release.name}@${release.version}`,
                )
                assert.equal(existing, null, 'Contradictory GitHub absence evidence')
                return null
            }
            assert.ok(
                tags &&
                    Object.keys(tags).length > 0 &&
                    Object.values(tags).every(
                        (version) =>
                            typeof version === 'string' &&
                            /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/.test(version),
                    ),
                'GitHub package registry metadata is unreadable/ambiguous; restore known mirror Read access before publication',
            )
        }
        return registryMetadata(run, registry, `${release.name}@${release.version}`)
    })
}

export function publish(release, destination, run, registry, tag = 'latest', options = {}) {
    assert.ok(['latest', 'recovery'].includes(tag), 'Expected latest or recovery dist-tag')
    const confirmedAbsent = ownerConfirmedAbsence(release, destination)
    preflight(
        release,
        options.lookup ?? ((target) => lookupCopy(release, target, withRegistry, confirmedAbsent)),
    )
    const spec = `${release.name}@${release.version}`
    const existing = registryMetadata(run, registry, spec)
    if (existing) {
        assertSameArtifact(existing, release)
        console.log(`${destination}: identical ${spec} already exists; skipped`)
        return
    }
    if (tag === 'latest') {
        const latest = registryMetadata(run, registry, release.name, 'dist-tags')?.latest
        if (latest) {
            assert.match(
                latest,
                /^\d+\.\d+\.\d+$/,
                'Non-stable latest requires explicit recovery tag',
            )
            const current = latest.split('.').map(Number)
            const target = release.version.split('.').map(Number)
            const firstDifference = current.findIndex((part, index) => part !== target[index])
            assert.ok(
                firstDifference === -1 || current[firstDifference] < target[firstDifference],
                `Registry latest ${latest} is newer than ${release.version}; use recovery tag to preserve latest`,
            )
        }
    }
    const args = [
        'publish',
        release.tarball,
        '--ignore-scripts',
        `--tag=${tag}`,
        `--registry=${registry}`,
    ]
    // GitHub visibility is administered independently; do not infer it from npm access.
    // The tarball comes from an earlier run; GITHUB_SHA would attest the publisher commit.
    // Disable even OIDC's automatic provenance rather than claim the wrong build source.
    if (destination === 'npm') args.push('--access=public', '--provenance=false')
    const result = run(args, options.interactive ? { stdio: 'inherit' } : {})
    if (result.status !== 0)
        throw new Error(`Publish failed: ${result.stderr || result.error || result.stdout}`)
    assertSameArtifact(registryMetadata(run, registry, spec), release)
    console.log(`${destination}: verified ${spec}`)
}

// Operator-only: keep login credentials in the isolated npm config. Metadata stays captured;
// publication inherits the terminal because npm may ask for fresh 2FA after login.
export function bootstrap(release, run, registry, tag = 'latest', options = {}) {
    const login = run(['login', `--registry=${registry}`], { stdio: 'inherit' })
    assert.equal(login.status, 0, 'npm login failed')
    publish(release, 'npm', run, registry, tag, { ...options, interactive: true })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, directory, sourceSha, versionOrRef, destination, tag] = process.argv.slice(2)
    if (command === 'pack')
        console.log(JSON.stringify(pack(directory, sourceSha, versionOrRef), null, 2))
    else if (command === 'verify')
        console.log(JSON.stringify(verify(directory, sourceSha, versionOrRef), null, 2))
    else if (command === 'bootstrap') {
        const binding = await verifySource(directory, sourceSha, versionOrRef)
        const release = { ...verify(directory, sourceSha, versionOrRef), ...binding }
        withRegistry('npm', (run, registry) => bootstrap(release, run, registry, destination))
    } else if (command === 'publish') {
        const binding = await verifySource(directory, sourceSha, versionOrRef)
        const release = { ...verify(directory, sourceSha, versionOrRef), ...binding }
        withRegistry(destination, (run, registry) =>
            publish(release, destination, run, registry, tag),
        )
    } else throw new Error('Expected pack, verify, bootstrap or publish')
}
