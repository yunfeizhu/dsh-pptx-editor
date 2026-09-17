# Security Policy

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

## Supported versions

The project is in repository setup and planning. No plugin runtime or supported
release line exists yet. Security fixes to current tooling and configuration
target the default branch. Supported release lines will be documented when
runtime releases become available.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue or PR. Use the
repository's
[private vulnerability reporting form](https://github.com/yunfeizhu/dsh-pptx-editor/security/advisories/new)
under **Security → Advisories → Report a vulnerability** when available.

If private reporting is unavailable, open an issue requesting a private security
contact method without describing the vulnerability. Wait for that channel
before sending technical details.

Include the affected version or commit, component, impact, reproduction steps,
and any suggested mitigation. Use a synthetic reproduction. Do not include live
credentials, private PPTX files, private prompts, or unredacted runtime traffic.

Maintainers will respond as soon as practical, coordinate validation and fixes
privately, and publish an advisory when a fix or mitigation is available. No
fixed response-time commitment is currently offered.

## Security boundaries

The planned plugin integrates a PPTX editor with DSH; it does not provide a
sandbox for the host or its other tools. The host and harness remain responsible
for their tool permissions, process isolation, network policy, and credentials.

Plugin development must preserve document ownership, confirmation before Agent
changes, writes scoped to the opened file, and protection against stale updates.
These are requirements until the implementation and tests establish them.
