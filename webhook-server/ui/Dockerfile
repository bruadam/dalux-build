FROM node:22-alpine AS dependencies

WORKDIR /workspace
COPY javascript ./javascript
COPY webhook-server/ui/package.json ./webhook-server/ui/package.json
COPY webhook-server/ui/package-lock.json ./webhook-server/ui/package-lock.json
COPY webhook-server/ui/.npmrc ./webhook-server/ui/.npmrc
RUN cd webhook-server/ui && npm ci

FROM node:22-alpine AS builder

WORKDIR /workspace
COPY --from=dependencies /workspace/webhook-server/ui/node_modules ./webhook-server/ui/node_modules
COPY webhook-server/ui ./webhook-server/ui
WORKDIR /workspace/webhook-server/ui
RUN npm run build

FROM node:22-alpine AS runtime

RUN addgroup --system --gid 1001 nextjs \
    && adduser --system --uid 1001 --ingroup nextjs nextjs
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=nextjs:nextjs /workspace/webhook-server/ui/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /workspace/webhook-server/ui/.next/static ./webhook-server/ui/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "webhook-server/ui/server.js"]
