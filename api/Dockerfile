# Contexto de build: a raiz do repositório (o lockfile e o pacote de contratos ficam lá).
#   docker build -f api/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts ./packages/contracts
COPY api/package.json ./api/
RUN npm ci -w api --include-workspace-root
COPY api/tsconfig.json ./api/
COPY api/src ./api/src
COPY api/test ./api/test
RUN npm run build -w api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY api/package.json ./api/
RUN npm ci -w api --omit=dev
COPY --from=build /app/api/dist ./api/dist
# O executor de migrations resolve ../../migrations a partir de src/scripts.
COPY api/src/scripts/migrate.mjs ./api/src/scripts/migrate.mjs
COPY api/migrations ./api/migrations
WORKDIR /app/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
