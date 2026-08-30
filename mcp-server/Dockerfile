# Build from the repo root: docker build -f mcp-server/Dockerfile .
# Multi-stage build: npm workspaces need the root package.json/lockfile plus
# the javascript/ (dalux-build-api) source, since mcp-server depends on it
# as a workspace package rather than a published npm version.
FROM node:22-slim AS builder

WORKDIR /build
COPY package.json package-lock.json ./
COPY javascript/package.json javascript/package.json
COPY mcp-server/package.json mcp-server/package.json
RUN npm ci

COPY javascript ./javascript
COPY mcp-server ./mcp-server
RUN npm run build --workspace=javascript \
    && npm run build --workspace=mcp-server

FROM node:22-slim AS runtime

# node:22-slim already ships a non-root "node" user (uid 1000) — reuse it
# rather than creating a new one (which collides with that uid).
WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/javascript ./javascript
COPY --from=builder /build/mcp-server ./mcp-server
RUN chown -R node:node /app
USER node

WORKDIR /app/mcp-server
ENV PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/mcp', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

# No Dalux credentials are baked in or expected as env vars here — the HTTP
# transport takes them per-request from the connecting client's own MCP
# config (X-Dalux-Base-Url / X-Dalux-Api-Key headers, see README). Optionally
# set DALUX_MCP_TOKEN at `docker run` time for an extra shared-secret gate.
ENTRYPOINT ["node", "dist/cli.js", "--transport", "http"]
