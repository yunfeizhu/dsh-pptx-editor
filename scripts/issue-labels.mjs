const labels = {
  bug: { name: 'bug', color: 'd73a4a', description: 'An observable defect' },
  enhancement: {
    name: 'enhancement',
    color: 'a2eeef',
    description: 'A proposed capability',
  },
  documentation: {
    name: 'documentation',
    color: '0075ca',
    description: 'Documentation improvements',
  },
  question: {
    name: 'question',
    color: 'd876e3',
    description: 'A usage or behavior question',
  },
  triage: {
    name: 'needs-triage',
    color: 'ededed',
    description: 'Needs maintainer classification',
  },
};

export function classifyIssue(title) {
  if (/^\s*(\[bug\]|bug\s*:|\[缺陷\])/i.test(title)) return labels.bug;
  if (/^\s*(\[feature\]|(?:feat|feature)\s*:|\[功能\])/i.test(title))
    return labels.enhancement;
  if (/^\s*(\[docs?\]|docs?\s*:|\[文档\])/i.test(title))
    return labels.documentation;
  if (/^\s*(\[question\]|question\s*:|\[提问\])/i.test(title))
    return labels.question;
  return labels.triage;
}

export async function applyIssueLabels({ github, context }) {
  const target = { ...context.repo, issue_number: context.issue.number };
  // Read the current issue so an older queued event cannot classify an old title.
  const { data: issue } = await github.rest.issues.get(target);
  const existing = issue.labels.map((label) =>
    typeof label === 'string' ? label : label.name,
  );
  const label = classifyIssue(issue.title);
  if (existing.includes(label.name)) return;
  // Unknown titles do not add triage to issues already categorized by maintainers.
  if (
    label.name === 'needs-triage' &&
    existing.some((name) =>
      Object.values(labels).some((item) => item.name === name),
    )
  )
    return;
  try {
    await github.rest.issues.getLabel({ ...context.repo, name: label.name });
  } catch (error) {
    if (error.status !== 404) throw error;
    try {
      await github.rest.issues.createLabel({ ...context.repo, ...label });
    } catch (createError) {
      if (createError.status !== 422) throw createError;
      // Two different issues can race to create the same repository label.
      await github.rest.issues.getLabel({ ...context.repo, name: label.name });
    }
  }
  await github.rest.issues.addLabels({ ...target, labels: [label.name] });
}
