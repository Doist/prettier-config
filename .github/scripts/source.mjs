import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = 'todoist/prettier-config'
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

function selection(version) {
    assert.match(version, /^\d+\.\d+\.\d+$/)
    const runId = process.env.SOURCE_RUN_ID
    const artifactId = process.env.SOURCE_ARTIFACT_ID
    assert.match(runId ?? '', /^[1-9]\d*$/, 'Set the original SOURCE_RUN_ID')
    assert.match(artifactId ?? '', /^[1-9]\d*$/, 'Set the original SOURCE_ARTIFACT_ID')
    return { runId, artifactId, version }
}

async function request(path, binary = false) {
    assert.ok(
        process.env.GH_TOKEN,
        'GH_TOKEN needs Actions:read and Contents:read for source evidence',
    )
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
        headers: {
            Authorization: `Bearer ${process.env.GH_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'manual',
    })
    if (binary && response.status === 302) {
        const url = new URL(response.headers.get('location'))
        assert.equal(url.protocol, 'https:')
        // The signed storage URL receives no GitHub credential.
        const archive = await fetch(url, { redirect: 'error' })
        assert.ok(archive.ok, `Archive download failed: ${archive.status}`)
        return Buffer.from(await archive.arrayBuffer())
    }
    assert.ok(
        response.ok,
        `Source API failed: ${response.status}; retain original bytes, do not repack`,
    )
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json()
}

export async function originalSource(selected, get = request) {
    const { runId, artifactId, version } = selected
    // Never use actions/runs/ID's mutable latest-attempt conclusion.
    const run = await get(`actions/runs/${runId}/attempts/1`)
    assert.equal(String(run.id), runId)
    assert.equal(run.run_attempt, 1)
    assert.equal(run.status, 'completed')
    assert.equal(run.conclusion, 'success', 'Original attempt must have succeeded')
    assert.equal(run.path.split('@')[0], '.github/workflows/pack.yml')
    assert.ok(Number.isSafeInteger(run.workflow_id) && run.workflow_id > 0)
    assert.equal(run.repository.full_name.toLowerCase(), repo)
    assert.equal(run.head_repository.full_name.toLowerCase(), repo)
    assert.equal(run.head_repository.id, run.repository.id)
    assert.ok(['push', 'workflow_dispatch'].includes(run.event))
    assert.ok(['main', `v${version}`].includes(run.head_branch))
    assert.match(run.head_sha, /^[a-f0-9]{40}$/)
    const comparison = await get(`compare/${run.head_sha}...main`)
    assert.ok(
        ['ahead', 'identical'].includes(comparison.status),
        'Source must remain on reviewed main history',
    )
    const artifact = await get(`actions/artifacts/${artifactId}`)
    assert.equal(String(artifact.id), artifactId)
    assert.equal(artifact.name, `prettier-config-${version}`)
    assert.equal(String(artifact.workflow_run.id), runId)
    assert.equal(artifact.workflow_run.head_sha, run.head_sha)
    assert.equal(artifact.workflow_run.repository_id, run.repository.id)
    assert.equal(artifact.workflow_run.head_repository_id, run.repository.id)
    assert.match(artifact.digest ?? '', /^sha256:[a-f0-9]{64}$/, 'API archive digest is required')
    const jobs = await get(`actions/runs/${runId}/attempts/1/jobs?per_page=100`)
    assert.equal(
        jobs.total_count,
        1,
        'Unsupported producer layout; recover original artifact, never repack',
    )
    const [job] = jobs.jobs
    assert.equal(job.name, 'pack')
    assert.equal(String(job.run_id), runId)
    assert.equal(job.head_sha, run.head_sha)
    assert.equal(job.conclusion, 'success')
    const created = Date.parse(artifact.created_at)
    assert.ok(
        created >= Date.parse(job.started_at) && created <= Date.parse(job.completed_at),
        'Archive does not belong to original successful attempt',
    )
    return { run, artifact, selected }
}

function archiveEntries(path) {
    const names = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n')
    assert.equal(new Set(names).size, names.length, 'Duplicate archive entries')
    return new Map(names.map((name) => [name, execFileSync('unzip', ['-p', path, name])]))
}

export function bindArchive(evidence, archive, entries, localEntries = entries) {
    const { run, artifact, selected } = evidence
    assert.equal(digest(archive), artifact.digest, 'Archive differs from authoritative API digest')
    const filename = `todoist-prettier-config-${selected.version}.tgz`
    assert.deepEqual([...entries.keys()].sort(), [filename, 'release.json'].sort())
    for (const [name, bytes] of entries) {
        assert.ok(
            Buffer.isBuffer(localEntries.get(name)) && bytes.equals(localEntries.get(name)),
            `Local ${name} differs from original archive entry`,
        )
    }
    const release = JSON.parse(entries.get('release.json'))
    assert.equal(
        release.schema,
        1,
        'Unsupported source schema; retain original bytes for approved recovery, never repack',
    )
    assert.equal(release.sourceRunId, selected.runId)
    assert.equal(release.sourceRunAttempt, 1)
    assert.equal(release.sourceSha, run.head_sha)
    assert.ok(
        release.sourceRef === 'refs/heads/main' ||
            release.sourceRef === `refs/tags/v${selected.version}`,
    )
    assert.equal(
        release.sourceRef,
        run.head_branch === 'main' ? 'refs/heads/main' : `refs/tags/v${selected.version}`,
    )
    assert.equal(release.version, selected.version)
    assert.equal(release.filename, filename)
    return {
        sourceSha: run.head_sha,
        sourceRunId: selected.runId,
        sourceArtifactId: selected.artifactId,
        sourceArchiveDigest: artifact.digest,
    }
}

export async function fetchSource(directory, version, get = request) {
    const evidence = await originalSource(selection(version), get)
    const archive = await get(`actions/artifacts/${evidence.selected.artifactId}/zip`, true)
    assert.equal(digest(archive), evidence.artifact.digest)
    mkdirSync(directory, { recursive: true })
    const path = join(directory, 'source.zip')
    writeFileSync(path, archive, { flag: 'wx' })
    const entries = archiveEntries(path)
    const binding = bindArchive(evidence, archive, entries)
    for (const [name, bytes] of entries) writeFileSync(join(directory, name), bytes, { flag: 'wx' })
    return binding
}

export async function verifySource(directory, sourceSha, version, get = request) {
    const evidence = await originalSource(selection(version), get)
    assert.equal(
        evidence.run.head_sha,
        sourceSha,
        'Requested checkout SHA differs from original source',
    )
    const path = join(directory, 'source.zip')
    const archive = readFileSync(path)
    // Check before parsing the archive, then bind every local release byte to its original entry.
    assert.equal(digest(archive), evidence.artifact.digest)
    const entries = archiveEntries(path)
    return bindArchive(
        evidence,
        archive,
        entries,
        new Map([...entries.keys()].map((name) => [name, readFileSync(join(directory, name))])),
    )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command, directory, version] = process.argv.slice(2)
    assert.equal(command, 'fetch')
    const binding = await fetchSource(directory, version)
    if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `sha=${binding.sourceSha}\n`)
    console.log(JSON.stringify(binding, null, 2))
}
