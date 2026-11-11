import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { originalSource, bindArchive } from './source.mjs'
import { lookupCopy, publish } from './release.mjs'

// Synthetic API/archive responses only: no real archive, registry or workflow operations.
const selected = { runId: '42', artifactId: '84', version: '4.0.2' }
const sha = 'a'.repeat(40)
const archive = Buffer.from('mock original archive bytes')
const archiveDigest = `sha256:${createHash('sha256').update(archive).digest('hex')}`
const repo = { id: 10, full_name: 'todoist/prettier-config' }
function fixture() {
    return {
        run: {
            id: 42,
            run_attempt: 1,
            status: 'completed',
            conclusion: 'success',
            path: '.github/workflows/pack.yml',
            workflow_id: 7,
            repository: repo,
            head_repository: repo,
            event: 'workflow_dispatch',
            head_branch: 'main',
            head_sha: sha,
        },
        artifact: {
            id: 84,
            name: 'prettier-config-4.0.2',
            digest: archiveDigest,
            created_at: '2026-11-10T12:01:00Z',
            workflow_run: { id: 42, repository_id: 10, head_repository_id: 10, head_sha: sha },
        },
        jobs: {
            total_count: 1,
            jobs: [
                {
                    name: 'pack',
                    run_id: 42,
                    head_sha: sha,
                    conclusion: 'success',
                    started_at: '2026-11-10T12:00:00Z',
                    completed_at: '2026-11-10T12:02:00Z',
                },
            ],
        },
        selected,
    }
}
function api(data, calls = []) {
    return async (path) => {
        calls.push(path)
        if (path === 'actions/runs/42/attempts/1') return data.run
        if (path === `compare/${sha}...main`) return { status: 'ahead' } // Later main maintenance is allowed.
        if (path === 'actions/artifacts/84') return data.artifact
        if (path === 'actions/runs/42/attempts/1/jobs?per_page=100') return data.jobs
        if (path === 'actions/runs/42')
            return { ...data.run, run_attempt: 2, conclusion: 'failure' }
        throw new Error(`Unexpected API request ${path}`)
    }
}
function entries() {
    return new Map([
        ['todoist-prettier-config-4.0.2.tgz', Buffer.from('mock original tarball bytes')],
        [
            'release.json',
            Buffer.from(
                JSON.stringify({
                    schema: 1,
                    sourceRunId: '42',
                    sourceRunAttempt: 1,
                    sourceSha: sha,
                    sourceRef: 'refs/heads/main',
                    version: '4.0.2',
                    filename: 'todoist-prettier-config-4.0.2.tgz',
                }),
            ),
        ],
    ])
}

test('original successful attempt remains usable after a later failed/skipped rerun and main maintenance', async () => {
    const calls = []
    const evidence = await originalSource(selected, api(fixture(), calls))
    const result = bindArchive(evidence, archive, entries())
    assert.equal(result.sourceSha, sha)
    assert.equal(result.sourceArchiveDigest, archiveDigest)
    assert.equal(calls.includes('actions/runs/42'), false)
    assert.equal(
        calls.some((path) => path.includes('contents/') || path.includes('workflows/')),
        false,
    )
})

test('wrong attempt, unsuccessful original, swapped archive and mismatched checkout are rejected', async () => {
    for (const change of [
        (data) => {
            data.run.run_attempt = 2
        },
        (data) => {
            data.run.conclusion = 'failure'
        },
        (data) => {
            data.artifact.id = 85
        },
        (data) => {
            data.artifact.workflow_run.id = 43
        },
        (data) => {
            data.artifact.workflow_run.head_sha = 'b'.repeat(40)
        },
        (data) => {
            data.artifact.created_at = '2026-11-10T13:01:00Z'
        },
    ]) {
        const data = fixture()
        change(data)
        await assert.rejects(() => originalSource(selected, api(data)))
    }
    assert.throws(
        () => bindArchive(fixture(), Buffer.from('different archive'), entries()),
        /API digest/,
    )
    const wrongAttempt = entries()
    const manifest = JSON.parse(wrongAttempt.get('release.json'))
    manifest.sourceRunAttempt = 2
    wrongAttempt.set('release.json', Buffer.from(JSON.stringify(manifest)))
    assert.throws(() => bindArchive(fixture(), archive, wrongAttempt))
})

test('self-consistent local hashes cannot replace authoritative archive entry bytes', () => {
    const local = entries()
    local.set('todoist-prettier-config-4.0.2.tgz', Buffer.from('different local tarball'))
    const manifest = JSON.parse(local.get('release.json'))
    manifest.integrity = `sha512:${createHash('sha512')
        .update(local.get('todoist-prettier-config-4.0.2.tgz'))
        .digest('base64')}`
    local.set('release.json', Buffer.from(JSON.stringify(manifest)))
    assert.throws(
        () => bindArchive(fixture(), archive, entries(), local),
        /differs from original archive entry/,
    )
})

test('known GitHub mirror root404/malformed registry metadata prevents any write; readable tags allow version404', () => {
    const release = { name: '@todoist/prettier-config', version: '4.0.2' }
    const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) }
    const ok = (value) => ({ status: 0, stdout: JSON.stringify(value) })
    for (const response of [missing, ok({}), ok({ latest: null })]) {
        const writes = []
        // Even presumed REST200 / whoami success must not replace actual registry readability.
        assert.throws(
            () =>
                publish(
                    release,
                    'npm',
                    (args) => {
                        writes.push(args)
                        return ok({})
                    },
                    'https://registry.npmjs.org/',
                    'latest',
                    {
                        lookup: (destination) =>
                            lookupCopy(release, destination, (target, callback) =>
                                callback(
                                    () => (target === 'github' ? response : missing),
                                    `https://${target}/`,
                                ),
                            ),
                    },
                ),
            /registry metadata is unreadable/,
        )
        assert.equal(writes.length, 0)
    }
    const responses = [ok({ latest: '4.0.1' }), missing]
    assert.equal(
        lookupCopy(release, 'github', (destination, callback) =>
            callback(() => responses.shift(), 'https://npm.pkg.github.com/'),
        ),
        null,
    )
})
