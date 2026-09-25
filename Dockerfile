# Streamable HTTP deployment. stdio users should use `npx uk-drone-airspace-mcp` instead.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts/bundle.mjs ./scripts/
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    MCP_TRANSPORT=http \
    PORT=8080 \
    DRONE_AIRSPACE_CACHE_DIR=/data
RUN mkdir -p /data && chown node:node /data
# dist/index.js is a self-contained bundle; no node_modules needed at runtime.
COPY --from=build /app/dist ./dist
COPY package.json licences ./
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js", "--transport", "http"]
