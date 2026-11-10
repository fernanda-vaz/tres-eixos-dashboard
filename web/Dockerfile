# Contexto de build: a raiz do repositório (o lockfile e o pacote de contratos ficam lá).
#   docker build -f web/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts ./packages/contracts
COPY web/package.json ./web/
RUN npm ci -w web --include-workspace-root
COPY web ./web
RUN npm run build -w web

FROM nginx:stable-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
