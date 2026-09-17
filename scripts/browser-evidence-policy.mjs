import { createHash } from 'node:crypto';

export const evidenceVersion = 1;
export const sha = (value) => createHash('sha256').update(value).digest('hex');
export const isCommit = (value) => /^[a-f0-9]{40}$/.test(value ?? '');
const isId = (value) => Number.isSafeInteger(value) && value > 0;

// Unknown paths are inputs. Only known documentation and release metadata are omitted.
export function isDocumentation(path, mode) {
  if (mode !== '100644' && mode !== '100755') return false;
  return (
    path === '.release-please-manifest.json' ||
    new Set([
      'README.md',
      'README.zh-CN.md',
      'CHANGELOG.md',
      'CONTRIBUTING.md',
      'AGENTS.md',
      'CLAUDE.md',
      'CODE_OF_CONDUCT.md',
      'SECURITY.md',
      'THIRD_PARTY_NOTICES.md',
    ]).has(path) ||
    /^(docs|\.agents)\/.*\.md$/.test(path) ||
    /^docs\/assets\/(conversation-editing|tables-and-charts)\.png$/.test(
      path,
    ) ||
    path === '.github/pull_request_template.md' ||
    /^\.github\/ISSUE_TEMPLATE\/[^/]+\.yml$/.test(path)
  );
}

export function sourceFingerprint(entries, packageJson) {
  const manifest = JSON.parse(packageJson);
  delete manifest.version;
  const inputs = entries
    .filter(({ path, mode }) => !isDocumentation(path, mode))
    .map(({ path, mode, oid }) => [
      path,
      mode,
      path === 'package.json' ? sha(JSON.stringify(manifest)) : oid,
    ])
    .sort((a, b) => a[0].localeCompare(b[0], 'en'));
  return sha(JSON.stringify(inputs));
}

export function fingerprint({ source, assets, environment }) {
  return sha(JSON.stringify({ evidenceVersion, source, assets, environment }));
}

export function eligibleRun(run, repository, currentRunId) {
  return (
    isId(run.id) &&
    isId(run.run_attempt) &&
    String(run.id) !== currentRunId &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository &&
    run.path === '.github/workflows/ci.yml' &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    isCommit(run.head_sha) &&
    ((run.event === 'push' && run.head_branch === 'main') ||
      run.event === 'pull_request')
  );
}

export function matchingMergedPull(pull, run, repository) {
  return (
    pull.merged_at &&
    pull.base?.ref === 'main' &&
    pull.base?.repo?.full_name === repository &&
    pull.head?.repo?.full_name === repository &&
    pull.head?.ref === run.head_branch &&
    isCommit(pull.head?.sha) &&
    isCommit(pull.merge_commit_sha)
  );
}

export function hasBrowserExecution(jobs) {
  return jobs.some(
    (job) =>
      job.name === 'Repository checks' &&
      job.conclusion === 'success' &&
      ['Run browser regression', 'Record browser test evidence'].every((name) =>
        job.steps?.some(
          (step) => name === step.name && step.conclusion === 'success',
        ),
      ),
  );
}

export function matchingEvidence(record, run, current) {
  return (
    record.schema === evidenceVersion &&
    record.repository === current.repository &&
    record.runId === String(run.id) &&
    record.runAttempt === String(run.run_attempt) &&
    record.head === run.head_sha &&
    isCommit(record.testedCommit) &&
    record.source === current.source &&
    record.assets === current.assets &&
    JSON.stringify(record.environment) ===
      JSON.stringify(current.environment) &&
    record.fingerprint === fingerprint(current)
  );
}

// Evidence is never chained: a reused run cannot become a new browser-test witness.
export async function findBrowserEvidence(current, io, now = Date.now) {
  const deadline = now() + 60_000;
  if (current.event === 'workflow_dispatch')
    return { reason: 'Manual CI explicitly runs browser regression.' };
  if (!current.environment.image || !current.environment.imageVersion)
    return { reason: 'Runner image identity is unavailable.' };
  let runs;
  try {
    runs = await io.runs();
  } catch {
    return { reason: 'Cannot read CI evidence; running browser regression.' };
  }
  let unavailable = false;
  for (const run of runs.slice(0, 30)) {
    if (now() >= deadline)
      return {
        reason: 'Evidence lookup budget reached; running browser regression.',
      };
    if (!eligibleRun(run, current.repository, current.runId)) continue;
    try {
      // Recompute from Git, rather than trusting a fingerprint in an uploaded file.
      if ((await io.source(run.head_sha)) !== current.source) continue;
      let related = false;
      if (run.event === 'push') {
        related = await io.ancestor(run.head_sha, current.testedCommit);
      } else if (
        current.event === 'pull_request' &&
        current.headRepository === current.repository &&
        run.head_branch === current.headBranch
      ) {
        related = await io.ancestor(run.head_sha, current.head);
      } else {
        for (const pull of await io.pulls(run.head_sha)) {
          if (
            matchingMergedPull(pull, run, current.repository) &&
            (await io.ancestor(run.head_sha, pull.head.sha)) &&
            (await io.ancestor(pull.merge_commit_sha, current.testedCommit))
          ) {
            related = true;
            break;
          }
        }
      }
      if (!related) continue;
      // Rerunning a different failed job advances the run attempt without
      // rerunning successful browser checks. Keep their original identity.
      for (
        let attempt = run.run_attempt;
        attempt >= Math.max(1, run.run_attempt - 4);
        attempt--
      ) {
        if (now() >= deadline)
          return {
            reason:
              'Evidence lookup budget reached; running browser regression.',
          };
        const witnessRun = { ...run, run_attempt: attempt };
        if (!hasBrowserExecution(await io.jobs(witnessRun))) continue;
        const record = await io.evidence(witnessRun);
        if (!record || !matchingEvidence(record, witnessRun, current)) continue;
        if (run.event === 'push') {
          if (record.testedCommit !== run.head_sha) continue;
        } else {
          const parents = await io.parents(record.testedCommit);
          if (
            parents.length !== 2 ||
            !isCommit(parents[0]) ||
            parents[1] !== run.head_sha
          )
            continue;
        }
        // PR checks execute the synthetic merge tree, not just the branch head.
        if ((await io.source(record.testedCommit)) !== current.source) continue;
        return {
          run: witnessRun,
          reason: `Identical browser inputs and built assets (attempt ${attempt}).`,
        };
      }
    } catch {
      unavailable = true;
    }
  }
  return {
    reason: unavailable
      ? 'Some evidence was unavailable or invalid; no verified match was found.'
      : 'No successful, related CI evidence matches these browser inputs and assets.',
  };
}
