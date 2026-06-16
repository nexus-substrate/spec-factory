# spec-factory

AI software factory pipeline E2E tester for [nexus-agents](https://github.com/nexus-substrate/nexus-agents). Exercises `execute_spec`, `query_trace`, and `registry_import`.

## Quick start

```bash
pnpm install
pnpm test        # Run unit tests
pnpm typecheck   # TypeScript strict check
pnpm build       # Compile to dist/
```

## MCP tools covered

| Tool | Purpose |
|------|---------|
| `execute_spec` | Execute markdown spec through full pipeline |
| `query_trace` | Query execution traces by run ID |
| `registry_import` | Import model to registry (dry run) |

## License

MIT
