# Suggested commands (run from agent-bot/ unless noted)

- `npm run check:types` — tsc --noEmit. Run to validate types.
- `npm run lint` — eslint src. `npm run lint:fix` to auto-fix.
- `npm test` — full jest suite (ESM). `npm test -- <name>` for a single spec (e.g. `npm test -- health`).
- `npm run build` — tsc build to dist/.
- `npm run start:dev` — tsx watch src/index.ts (needs .env: MCP_SERVER_URL, OPENAI_*, DISCORD_BOT_TOKEN, POSTGRES_*).
- `npm run db:generate` / `npm run db:migrate` — drizzle.

Repo root:
- `docker compose up -d` — infra (Postgres/OpenSearch/ChromaDB/Neo4j).
- Git: standard `git status/diff/log`. This is a git worktree — check `git worktree list` if confused about which worktree is which.

After code changes in agent-bot/: run `npm run check:types` AND `npm run lint` AND `npm test` — all three must pass.