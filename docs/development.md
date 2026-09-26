# Development

Back to the [README](../README.md). The pipeline layout, conventions and guardrails are in [CLAUDE.md](../CLAUDE.md).

```bash
npm install
npm test                                  # offline vitest suite
npm run lint && npm run typecheck
npm run build && npx @modelcontextprotocol/inspector node dist/index.js
npm run pack:build -- --region south-west --tag pack-dev   # build a small real pack (network)
PACK_PATH=build/pack/pack-dev.sqlite node dist/index.js
```

Releases: tag `vX.Y.Z` to publish to npm and attach the `.mcpb` bundle. The data pack has its own release cadence driven by `build-pack.yml`.
