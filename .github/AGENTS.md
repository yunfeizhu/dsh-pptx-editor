# GitHub automation rules

Follow the [root guide](../AGENTS.md).

- Pin external Actions to full commit SHAs with version comments.
- Default to `contents: read`; grant additional scopes only to the job that
  needs them. Disable persisted checkout credentials.
- PR jobs execute untrusted code with no secrets or write permissions. Avoid
  privileged PR triggers. Issue automation may check out only the default branch
  and treat issue content as data.
- Set timeouts and concurrency. Do not cancel release or issue-label mutations
  midway merely because another event arrives.
- Never interpolate issue/PR content directly into shell or JavaScript source.
- Preserve stable required job names. Branch protection, dependency graph,
  hosted reviews, and publishing credentials are external settings, not facts
  established by a workflow file.
- Validate normal, bot, failure, and permission paths. Local static policy tests
  are not proof that a remote workflow ran.
