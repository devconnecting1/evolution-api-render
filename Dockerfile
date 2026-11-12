# Exact version: a floating tag may reuse a cached, unpatched layer (Node 24 CVEs of Oct/2026, #2761). Dependabot bumps it.
FROM node:24.22.3-alpine AS builder

RUN apk update && \
    apk add --no-cache git ffmpeg wget curl bash openssl

LABEL version="2.3.1" description="Api to control whatsapp features through http requests." 
LABEL maintainer="Davidson Gomes" git="https://github.com/DavidsonGomes"
LABEL contact="contato@evolution-api.com"

WORKDIR /evolution

COPY ./package*.json ./
COPY ./tsconfig.json ./
COPY ./tsup.config.ts ./

RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" && \
    git config --global --add url."https://github.com/".insteadOf "git@github.com:" && \
    npm config set allow-git all

RUN npm ci --silent

COPY ./src ./src
COPY ./public ./public
COPY ./prisma ./prisma
COPY ./manager ./manager
COPY ./.env.example ./.env
COPY ./runWithProvider.js ./
COPY ./prisma7.config.ts ./
# Manuals exposed by the MCP server as whatsai://docs/* (small Markdown files)
COPY ./README-WHATSAI.md ./
COPY ./readmes ./readmes

COPY ./Docker ./Docker

RUN chmod +x ./Docker/scripts/* && dos2unix ./Docker/scripts/*

RUN ./Docker/scripts/generate_database.sh

# tsup bundles every file of src with its sourcemap: the default ~2 GB heap is no longer enough
# (the Render build pipeline has 8 GB). Build stage only, the final image does not inherit it.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

FROM node:24.22.3-alpine AS final

RUN apk update && \
    apk add tzdata ffmpeg bash openssl

ENV TZ=America/Sao_Paulo
ENV DOCKER_ENV=true

WORKDIR /evolution

COPY --from=builder /evolution/package.json ./package.json
COPY --from=builder /evolution/package-lock.json ./package-lock.json

COPY --from=builder /evolution/node_modules ./node_modules
COPY --from=builder /evolution/dist ./dist
COPY --from=builder /evolution/prisma ./prisma
COPY --from=builder /evolution/manager ./manager
COPY --from=builder /evolution/public ./public
COPY --from=builder /evolution/.env ./.env
COPY --from=builder /evolution/Docker ./Docker
COPY --from=builder /evolution/runWithProvider.js ./runWithProvider.js
COPY --from=builder /evolution/prisma7.config.ts ./prisma7.config.ts
COPY --from=builder /evolution/README-WHATSAI.md ./README-WHATSAI.md
COPY --from=builder /evolution/readmes ./readmes
COPY --from=builder /evolution/tsup.config.ts ./tsup.config.ts

ENV DOCKER_ENV=true

EXPOSE 8080

ENTRYPOINT ["/bin/bash", "-c", ". ./Docker/scripts/deploy_database.sh && if [ -z \"$SERVER_URL\" ] && [ -n \"$RENDER_EXTERNAL_URL\" ]; then export SERVER_URL=\"$RENDER_EXTERNAL_URL\"; fi && npm run start:prod" ]
