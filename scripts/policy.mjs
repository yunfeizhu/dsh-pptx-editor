import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const referencesSecrets = (value) =>
  /\bsecrets\s*(?:\.|\[)/i.test(JSON.stringify(value ?? {}));

export function validateWorkflow(workflow) {
  const errors = [];
  if (
    !workflow ||
    typeof workflow !== 'object' ||
    !workflow.on ||
    !workflow.jobs
  )
    return ['Workflow must declare events and jobs.'];
  const events =
    typeof workflow.on === 'string'
      ? [workflow.on]
      : Array.isArray(workflow.on)
        ? workflow.on
        : Object.keys(workflow.on);
  if (
    events.some((event) =>
      ['pull_request_target', 'workflow_run'].includes(event),
    )
  )
    errors.push(
      'Privileged chained/PR triggers are outside the bootstrap policy.',
    );
  if (
    workflow.permissions?.contents !== 'read' ||
    Object.values(workflow.permissions).some((value) => value !== 'read')
  )
    errors.push('Workflow default permissions must be read-only.');
  if (!workflow.concurrency) errors.push('Workflow must define concurrency.');
  if (events.includes('pull_request') && referencesSecrets(workflow.env))
    errors.push('PR workflow environment must not reference secrets.');
  for (const [name, job] of Object.entries(workflow.jobs)) {
    if (
      !Number.isInteger(job['timeout-minutes']) ||
      job['timeout-minutes'] <= 0
    )
      errors.push(`${name}: set a positive timeout.`);
    const permissions = job.permissions ?? workflow.permissions ?? {};
    const hasWritePermissions =
      permissions === 'write-all' ||
      Object.values(permissions).some((value) => value === 'write');
    if (events.includes('pull_request') && hasWritePermissions)
      errors.push(`${name}: PR jobs must not have write permissions.`);
    if (events.includes('pull_request') && referencesSecrets(job.env))
      errors.push(`${name}: PR job environment must not reference secrets.`);
    for (const step of job.steps ?? []) {
      if (step.uses && !/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/.test(step.uses))
        errors.push(`${name}: pin each Action to a full commit SHA.`);
      if (step.uses?.startsWith('actions/checkout@')) {
        if (step.with?.['persist-credentials'] !== false)
          errors.push(`${name}: disable checkout credential persistence.`);
        if (
          events.includes('issues') &&
          step.with?.ref !== '${{ github.event.repository.default_branch }}'
        )
          errors.push(
            `${name}: issue automation must check out the default branch.`,
          );
      }
      if (events.includes('pull_request') && referencesSecrets(step))
        errors.push(`${name}: PR steps must not reference secrets.`);
      if (/\$\{\{/.test(step.run ?? ''))
        errors.push(
          `${name}: pass expressions through environment variables, not shell source.`,
        );
      if (/\$\{\{/.test(step.with?.script ?? ''))
        errors.push(
          `${name}: pass expressions as data, not JavaScript source.`,
        );
    }
  }
  return errors;
}

export function missingLocalLinks(markdown, file) {
  const errors = [];
  const text = markdown.replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(
    /\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const url = match[1].replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url)) continue;
    const path = decodeURIComponent(url.split(/[?#]/)[0]);
    if (path && !existsSync(resolve(dirname(file), path)))
      errors.push(`Missing local link: ${path}`);
  }
  return errors;
}

export function validateSkill(frontmatter, folder) {
  const errors = [];
  if (
    frontmatter?.name !== folder ||
    !/^[a-z0-9-]{1,64}$/.test(frontmatter?.name ?? '')
  )
    errors.push('Skill name must match its directory.');
  if (
    typeof frontmatter?.description !== 'string' ||
    !frontmatter.description.trim()
  )
    errors.push('Skill needs a nonempty description.');
  return errors;
}
