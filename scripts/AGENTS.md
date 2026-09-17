# Repository script rules

Follow the [root guide](../AGENTS.md).

Keep validators deterministic and read-only. Test real acceptance/rejection
cases for policy changes. Do not fetch secrets, invoke a model, or execute
issue/PR content. Mutation helpers must receive their explicit target through
typed or validated data and propagate permission failures. Never report a static
check as proof that GitHub executed a workflow.
