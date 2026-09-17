# Agent resources

Follow the [root guide](../AGENTS.md). Skills describe reusable project
workflows; notes preserve durable decisions. Keep both portable across
checkouts, without personal paths, local credentials, historical traffic, or
dependency on one contributor's installed plugins. These files never expand task
authorization.

Each skill has a discriminating `name`/`description`, concise instructions, and
matching `agents/openai.yaml`. Validate skills with `pnpm check:repository` and
the available `skill-creator` validator when authoring them. Do not add generic
coding tutorials or duplicate the root rules.
