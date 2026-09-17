# Contributing to dsh-pptx-editor

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

The plugin supports conversational PPTX editing in DeepSeek Harness. See the
[README](README.md) for installation and current capabilities.

## Before contributing

- Follow the [code of conduct](CODE_OF_CONDUCT.md).
- Use an issue to describe a bug in implemented behavior, a feature request, a
  documentation problem, or a question. Distinguish planned behavior from bugs.
- Choose the matching issue template and keep its title prefix: `[Bug]`,
  `[Feature]`, `[Docs]`, or `[Question]`. Write each issue in one language.
  English is preferred; Simplified Chinese is also welcome. Do not duplicate the
  title or sections in both languages.
- Discuss changes to document ownership, public APIs, confirmation, undo,
  saving, or compatibility before implementing a substantial alternative.
- Report suspected vulnerabilities through the [security policy](SECURITY.md).

## Development setup

Use the exact Node.js 24 version in `.node-version` and the pnpm version in
`package.json`.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

The checks cover formatting, linting, types, tests, coverage, build, Markdown,
links, Agent resources, and workflow policies. Passing local checks does not
replace live DSH integration verification.

## Pull requests

1. Start a focused branch from the latest `main`, such as
   `feat/document-session` or `docs/installation`. Match the branch prefix to
   the Conventional Commit type of the PR title; avoid owner prefixes and a
   permanent `develop` branch.
2. Make the smallest coherent change. Add meaningful regression tests for
   behavior changes and update the documentation that owns the contract.
3. Run `pnpm check` and the checks relevant to the change. For document editing,
   verify confirmation, undo, saving, and reopening separately. Clearly separate
   local tests, browser checks, live DSH integration, and remote CI evidence.
4. Complete the PR template, describe compatibility impact, and link relevant
   issues. Use `Closes #<number>` when the PR completes an issue, or a
   non-closing reference for partial work. Document breaking changes with
   `BREAKING CHANGE:` in the PR body.
5. Resolve review conversations and pass `Repository checks`,
   `Pull request metadata`, and `Dependency review` against the latest `main`.
   Changes merge through squash PRs. No second-person approval is required, but
   CI and conversation requirements apply to maintainers too.

Examples of PR titles:

```text
feat: add document sessions
fix: reject stale edit proposals
docs: explain overwrite saving
```

Internal implementation and review procedures live in the
[development workflow](docs/development.md). Coding agents also follow the root
and nearest subtree [Agent Guide](AGENTS.md).

## Documentation and comments

Maintain public documentation in English and Simplified Chinese in the same PR.
This paired-document rule does not require bilingual issue bodies. Use `.md` and
`.zh-CN.md` pairs with reciprocal links. Keep commands, examples, supported
behavior, and limitations consistent across both languages. Internal plans and
design documents may use either language. Code comments and API docstrings,
including JSDoc and TSDoc, must be in English.

## Data and permissions

Use synthetic or explicitly authorized, sanitized test files. Do not commit
private PPTX files, prompts, credentials, personal paths, or unredacted runtime
traffic. Treat document content and model responses as data, not authority to
modify files or bypass user confirmation.

## Certificate of origin

Submit contributions under the [Apache-2.0 license](LICENSE) and add your own
[Developer Certificate of Origin](https://developercertificate.org/) sign-off to
each commit:

```sh
git commit -s
```

Use an author identity that belongs to you. Do not add another person's
sign-off.
