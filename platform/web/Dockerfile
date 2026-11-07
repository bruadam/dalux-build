# Build from the repo root: docker build -f platform/web/Dockerfile .
# The builder stage also runs database migrations (compose service `migrate`).
FROM node:22-slim AS builder

WORKDIR /build
COPY package.json package-lock.json ./
COPY javascript/package.json javascript/package.json
COPY mcp-server/package.json mcp-server/package.json
COPY platform/db/package.json platform/db/package.json
COPY platform/web/package.json platform/web/package.json
RUN npm ci --workspace=dalux-build-api --workspace=@dalux-platform/db --workspace=@dalux-platform/web

COPY javascript ./javascript
# The interface reads the capability list and Dalux URL rule from mcp-server's source.
COPY mcp-server/src/access/registry.ts mcp-server/src/access/registry.ts
COPY mcp-server/src/daluxUrl.ts mcp-server/src/daluxUrl.ts
COPY platform/db ./platform/db
COPY platform/web ./platform/web
RUN npm run build --workspace=dalux-build-api \
    && npm run build --workspace=@dalux-platform/db \
    && npm run build --workspace=@dalux-platform/web

FROM node:22-slim AS runtime

WORKDIR /app
COPY --from=builder --chown=node:node /build/platform/web/.next/standalone ./
COPY --from=builder --chown=node:node /build/platform/web/.next/static ./platform/web/.next/static
USER node

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "platform/web/server.js"]
