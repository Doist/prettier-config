import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack, verify, publish, registryMetadata, withRegistry } from './release.mjs'

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
