import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, appendFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { once } from 'node:events'
import {
    pack,
    verify,
    publish as guardedPublish,
    bootstrap,
    registryMetadata,
    withRegistry,
    lookupCopy,
    ownerConfirmedAbsence,
} from './release.mjs'

const registry = 'https://registry.npmjs.org/'
const release = {
    name: '@todoist/prettier-config',
    version: '4.0.2',
    tarball: '/retained/package.tgz',
    integrity: 'sha512-example',
    shasum: 'example-sha1',
}
const success = (value) => ({ status: 0, stdout: JSON.stringify(value) })
const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) }

// All registry responses are injected; no test below authenticates or writes remotely.
function publish(release, destination, run, registry, tag = 'latest', options = {}) {
    return guardedPublish(release, destination, run, registry, tag, {
        lookup: () => null,
        ...options,
    })
}

test('an identical existing release is verified without publication', () => {
    const calls = []
    publish(
        release,
        'npm',
        (args) => {
            calls.push(args)
            return success(release)
        },
        registry,
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'view')
})

test('a conflicting existing release fails without publication', () => {
    const calls = []
    assert.throws(
        () =>
            publish(
                release,
                'npm',
                (args) => {
                    calls.push(args)
                    return success({ integrity: 'sha512-different' })
                },
                registry,
            ),
        /integrity differs/,
    )
    assert.equal(calls.length, 1)
})

test('only a missing version publishes the supplied tarball and verifies the result', () => {
    for (const destination of ['npm', 'github']) {
        const calls = []
        const results = [missing, success({ latest: '4.0.1' }), success({}), success(release)]
        publish(
            release,
            destination,
            (args) => {
                calls.push(args)
                return results.shift()
            },
            registry,
        )
        assert.equal(calls.length, 4)
        assert.deepEqual(calls[2], [
            'publish',
            release.tarball,
            '--ignore-scripts',
            '--tag=latest',
            `--registry=${registry}`,
            ...(destination === 'npm' ? ['--access=public', '--provenance=false'] : []),
        ])
    }
})

test('authentication/network errors and mismatched post-publish checks fail closed', () => {
    for (const code of ['E401', 'E403', 'ETIMEDOUT']) {
        assert.throws(
            () =>
                registryMetadata(
                    () => ({ status: 1, stdout: JSON.stringify({ error: { code } }) }),
                    registry,
                    'pkg@1.0.0',
                ),
            /lookup failed/,
        )
    }
    const results = [missing, success({}), success({}), success({ shasum: 'different' })]
    assert.throws(
        () => publish(release, 'github', () => results.shift(), registry),
        /checksum differs/,
    )
})

test('explicit isolated scope routing overrides inherited npm configuration', () => {
    const previous = process.env.npm_config_registry
    process.env.npm_config_registry = 'https://wrong.invalid/'
    try {
        withRegistry('npm', (run, expectedRegistry) => {
            const result = run(['config', 'get', '@todoist:registry'])
            assert.equal(result.status, 0)
            assert.equal(result.stdout.trim(), expectedRegistry)
            assert.equal(run(['config', 'get', 'registry']).stdout.trim(), expectedRegistry)
        })
    } finally {
        if (previous === undefined) delete process.env.npm_config_registry
        else process.env.npm_config_registry = previous
    }
})

// Real local packing only; no publication, registry requests, or release record.
test('packed artifact verification rejects wrong source, wrong tag and modified bytes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'prettier-config-test-'))
    const sourceSha = '0'.repeat(40)
    try {
        const release = pack(directory, sourceSha, 'refs/heads/main')
        verify(directory, sourceSha, release.version)
        assert.throws(() => verify(directory, '1'.repeat(40), release.version))
        assert.throws(() => pack(directory, sourceSha, 'refs/tags/v0.0.0'), /matching version tag/)
        appendFileSync(join(directory, release.filename), 'modified')
        assert.throws(() => verify(directory, sourceSha, release.version))
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

test('older mirror recovery cannot downgrade latest and supports an explicit recovery tag', () => {
    const calls = []
    const results = [missing, success({ latest: '4.0.3' })]
    assert.throws(
        () =>
            publish(
                release,
                'npm',
                (args) => {
                    calls.push(args)
                    return results.shift()
                },
                registry,
            ),
        /use recovery tag to preserve latest/,
    )
    assert.equal(
        calls.some((args) => args[0] === 'publish'),
        false,
    )

    const recoveryCalls = []
    const recoveryResults = [missing, success({}), success(release)]
    publish(
        release,
        'npm',
        (args) => {
            recoveryCalls.push(args)
            return recoveryResults.shift()
        },
        registry,
        'recovery',
    )
    assert.ok(recoveryCalls[1].includes('--tag=recovery'))
    assert.ok(recoveryCalls[1].includes('--provenance=false'))
    assert.equal(recoveryCalls[1].includes('--tag=latest'), false)
})

test('cross-registry mismatch or ambiguous read aborts before a selected-destination write', () => {
    for (const destination of ['npm', 'github']) {
        for (const opposite of [
            { integrity: 'sha512-other' },
            undefined,
            'E401',
            'E403',
            'ETIMEDOUT',
        ]) {
            const calls = []
            assert.throws(() =>
                publish(
                    release,
                    destination,
                    (args) => {
                        calls.push(args)
                        return success({})
                    },
                    registry,
                    'latest',
                    {
                        lookup: (target) => {
                            if (target === destination) return null
                            if (typeof opposite === 'string') {
                                return registryMetadata(
                                    () => ({
                                        status: 1,
                                        stdout: JSON.stringify({ error: { code: opposite } }),
                                    }),
                                    registry,
                                    'pkg@1.0.0',
                                )
                            }
                            return opposite
                        },
                    },
                ),
            )
            assert.equal(
                calls.some((args) => args[0] === 'publish'),
                false,
            )
        }
    }
})

test('cross-registry missing and matching copies allow only the selected missing destination', () => {
    for (const destination of ['npm', 'github']) {
        for (const opposite of [null, release]) {
            const lookedUp = []
            const calls = []
            const results = [missing, success({ latest: '4.0.1' }), success({}), success(release)]
            publish(
                release,
                destination,
                (args) => {
                    calls.push(args)
                    return results.shift()
                },
                registry,
                'latest',
                {
                    lookup: (target) => {
                        lookedUp.push(target)
                        return target === destination ? null : opposite
                    },
                },
            )
            assert.deepEqual(lookedUp, ['npm', 'github'])
            assert.equal(calls.filter((args) => args[0] === 'publish').length, 1)
            assert.equal(calls.find((args) => args[0] === 'publish')[1], release.tarball)
        }
    }
    const calls = []
    publish(
        release,
        'npm',
        (args) => {
            calls.push(args)
            return success(release)
        },
        registry,
        'latest',
        { lookup: () => release },
    )
    assert.equal(
        calls.some((args) => args[0] === 'publish'),
        false,
    )
    assert.throws(() => registryMetadata(() => success(null), registry, 'pkg@1.0.0'), /Ambiguous/)
})

test('interactive bootstrap preflights both copies after login and preserves publication 2FA', () => {
    const blocked = []
    assert.throws(
        () =>
            bootstrap(
                release,
                (args, options) => {
                    blocked.push({ args, options })
                    return { status: 0 }
                },
                registry,
                'latest',
                {
                    lookup: (target) =>
                        target === 'github' ? { integrity: 'sha512-other' } : null,
                },
            ),
        /integrity differs/,
    )
    assert.deepEqual(
        blocked.map(({ args }) => args[0]),
        ['login'],
    )

    const events = []
    const results = [
        { status: 0 },
        missing,
        success({ latest: '4.0.1' }),
        { status: 0 },
        success(release),
    ]
    bootstrap(
        release,
        (args, options) => {
            events.push({ command: args[0], options })
            return results.shift()
        },
        registry,
        'latest',
        {
            lookup: (target) => {
                events.push({ command: `preflight:${target}` })
                return null
            },
        },
    )
    assert.deepEqual(
        events.map(({ command }) => command),
        ['login', 'preflight:npm', 'preflight:github', 'view', 'view', 'publish', 'view'],
    )
    assert.deepEqual(events[0].options, { stdio: 'inherit' })
    assert.deepEqual(events.find(({ command }) => command === 'publish').options, {
        stdio: 'inherit',
    })
    assert.equal(events.find(({ command }) => command === 'view').options, undefined)
})

test('cross-registry GitHub credentials are stripped from npm login and publication', () => {
    const keys = ['NODE_AUTH_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_PACKAGES_TOKEN']
    const previous = keys.map((key) => process.env[key])
    keys.forEach((key) => {
        process.env[key] = `mock-${key}`
    })
    try {
        for (const destination of ['npm', 'github']) {
            withRegistry(
                destination,
                (run) => {
                    run(['login'], { stdio: 'inherit' })
                    run(['publish', '/retained/package.tgz'], { stdio: 'inherit' })
                },
                (command, args, options) => {
                    assert.equal(command, 'npm')
                    assert.equal(options.stdio, 'inherit')
                    assert.equal(options.env.GH_TOKEN, undefined)
                    assert.equal(options.env.GITHUB_TOKEN, undefined)
                    assert.equal(
                        options.env.NODE_AUTH_TOKEN,
                        destination === 'github' ? 'mock-NODE_AUTH_TOKEN' : undefined,
                    )
                    return { status: 0 }
                },
            )
        }
    } finally {
        keys.forEach((key, index) => {
            if (previous[index] === undefined) delete process.env[key]
            else process.env[key] = previous[index]
        })
    }
})

test('registry errors support either JSON stream and reject contradictory errors', () => {
    assert.equal(
        registryMetadata(
            () => ({ status: 1, stdout: '', stderr: missing.stdout }),
            registry,
            'pkg@1.0.0',
        ),
        null,
    )
    assert.throws(
        () =>
            registryMetadata(
                () => ({ ...missing, stderr: JSON.stringify({ error: { code: 'E401' } }) }),
                registry,
                'pkg@1.0.0',
            ),
        /lookup failed/,
    )
})

test('recovery-only package tags are read without resolving latest', () => {
    const tags = { recovery: '4.0.1' }
    for (const value of [tags, [tags, tags]]) {
        const actual = registryMetadata(
            (args) => {
                assert.equal(args[1], `${release.name}@>=0`)
                assert.equal(args[2], 'dist-tags')
                return success(value)
            },
            registry,
            release.name,
            'dist-tags',
        )
        assert.deepEqual(actual, tags)
    }
    assert.throws(
        () =>
            registryMetadata(
                () => success([tags, { latest: '4.0.2' }]),
                registry,
                release.name,
                'dist-tags',
            ),
        /Inconsistent/,
    )
})

test('local first namespace requires exact artifact and destination confirmation before writes', () => {
    const bound = {
        ...release,
        sourceRunId: '123',
        sourceArtifactId: '456',
        sourceArchiveDigest: `sha256:${'a'.repeat(64)}`,
    }
    const previous = process.env.CONFIRMED_ABSENT_GITHUB_PACKAGE
    const previousActions = process.env.GITHUB_ACTIONS
    try {
        delete process.env.GITHUB_ACTIONS
        for (const destination of ['npm', 'github']) {
            const confirmation = `${bound.name}@${bound.version}:${destination}:123:456:${bound.sourceArchiveDigest}`
            for (const scenario of [
                'confirmed',
                'unconfirmed',
                'wrong-artifact',
                'actions',
                'unauthorized',
                'timeout',
                'malformed',
                'contradiction',
                'different-bytes',
            ]) {
                delete process.env.CONFIRMED_ABSENT_GITHUB_PACKAGE
                delete process.env.GITHUB_ACTIONS
                if (scenario !== 'unconfirmed')
                    process.env.CONFIRMED_ABSENT_GITHUB_PACKAGE =
                        scenario === 'wrong-artifact'
                            ? confirmation.replace(':456:', ':457:')
                            : confirmation
                if (scenario === 'actions') process.env.GITHUB_ACTIONS = 'true'
                const writes = []
                const results = [missing, missing, success({}), success(bound)]
                const attempt = () =>
                    guardedPublish(
                        bound,
                        destination,
                        (args) => {
                            if (args[0] === 'publish') writes.push(args)
                            return results.shift()
                        },
                        registry,
                        'latest',
                        {
                            lookup: (target) =>
                                target === 'npm'
                                    ? null
                                    : lookupCopy(
                                          bound,
                                          target,
                                          (_target, callback) =>
                                              callback((args) => {
                                                  if (args[0] === 'whoami')
                                                      return scenario === 'unauthorized'
                                                          ? { status: 1, stdout: '' }
                                                          : success('owner')
                                                  if (args[2] === 'dist-tags') {
                                                      if (scenario === 'timeout')
                                                          return {
                                                              status: 1,
                                                              stdout: '',
                                                              stderr: 'ETIMEDOUT',
                                                          }
                                                      if (scenario === 'malformed')
                                                          return success(null)
                                                      if (scenario === 'different-bytes')
                                                          return success({ latest: '4.0.1' })
                                                      return missing
                                                  }
                                                  return [
                                                      'contradiction',
                                                      'different-bytes',
                                                  ].includes(scenario)
                                                      ? success({ integrity: 'sha512-other' })
                                                      : missing
                                              }, 'https://npm.pkg.github.com/'),
                                          ownerConfirmedAbsence(bound, destination),
                                      ),
                        },
                    )
                if (scenario === 'confirmed') {
                    attempt()
                    assert.equal(writes.length, 1)
                    assert.equal(writes[0][1], bound.tarball)
                } else {
                    assert.throws(attempt, undefined, scenario)
                    assert.equal(writes.length, 0, scenario)
                }
            }
        }
    } finally {
        if (previous === undefined) delete process.env.CONFIRMED_ABSENT_GITHUB_PACKAGE
        else process.env.CONFIRMED_ABSENT_GITHUB_PACKAGE = previous
        if (previousActions === undefined) delete process.env.GITHUB_ACTIONS
        else process.env.GITHUB_ACTIONS = previousActions
    }
})

test('actual npm reads recovery-only tags from a local mock registry', async () => {
    const server = new Worker(
        `
        const { parentPort } = require('node:worker_threads')
        const { createServer } = require('node:http')
        const document = {
            name: '@todoist/prettier-config',
            'dist-tags': { recovery: '4.0.1' },
            versions: { '4.0.1': { name: '@todoist/prettier-config', version: '4.0.1' } }
        }
        const server = createServer((request, response) => {
            if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify(document))
        })
        server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port))
    `,
        { eval: true },
    )
    const directory = mkdtempSync(join(tmpdir(), 'prettier-config-registry-test-'))
    try {
        const [port] = await once(server, 'message')
        const mockRegistry = `http://127.0.0.1:${port}/`
        const config = join(directory, 'user.npmrc')
        const globalConfig = join(directory, 'global.npmrc')
        writeFileSync(config, `registry=${mockRegistry}\n@todoist:registry=${mockRegistry}\n`)
        writeFileSync(globalConfig, '')
        const env = Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !/token|^npm_config_/i.test(key)),
        )
        Object.assign(env, {
            NPM_CONFIG_USERCONFIG: config,
            NPM_CONFIG_GLOBALCONFIG: globalConfig,
            NPM_CONFIG_CACHE: join(directory, 'cache'),
        })
        const tags = registryMetadata(
            (args) =>
                spawnSync('npm', args, { cwd: directory, env, encoding: 'utf8', timeout: 15000 }),
            mockRegistry,
            release.name,
            'dist-tags',
        )
        assert.deepEqual(tags, { recovery: '4.0.1' })
    } finally {
        await server.terminate()
        rmSync(directory, { recursive: true, force: true })
    }
})
