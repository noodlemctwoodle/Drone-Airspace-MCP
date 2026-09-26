# Hosting

Back to the [README](../README.md).

## Remote connector on Cloudflare

Hosting your own copy:

```bash
npx wrangler login
```

```bash
npm run worker:setup
```

The setup script creates the D1 database and KV namespace, writes their ids into `wrangler.toml`, and loads the latest national pack into D1. Then `npm run worker:deploy` prints the URL. With the repository variable `CLOUDFLARE_DEPLOY=true` and the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` secrets set, GitHub Actions deploys on every push to `main` and reloads D1 whenever a new data pack is built.

## Streamable HTTP on your own server

```bash
npx -y fpv-airspace --transport http --port 8080
# or
docker build -t fpv-airspace . && docker run -p 8080:8080 -v drone-data:/data fpv-airspace
```

`POST /mcp` speaks the MCP streamable HTTP transport (stateless), `GET /healthz` reports pack and NOTAM cache state.
