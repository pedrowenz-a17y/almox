# syntax=docker/dockerfile:1
FROM node:22-alpine AS dependencies
WORKDIR /app
RUN --mount=type=secret,id=system_ca \
    if [ -f /run/secrets/system_ca ]; then SSL_CERT_FILE=/run/secrets/system_ca apk add --no-cache openssl libc6-compat; else apk add --no-cache openssl libc6-compat; fi
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true; else npm ci; fi

FROM dependencies AS tooling
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npx prisma generate; else npx prisma generate; fi
CMD ["npx", "prisma", "migrate", "deploy"]

FROM tooling AS builder
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm run build; else npm run build; fi

FROM node:22-alpine AS runner
WORKDIR /app
RUN --mount=type=secret,id=system_ca \
    if [ -f /run/secrets/system_ca ]; then SSL_CERT_FILE=/run/secrets/system_ca apk add --no-cache openssl libc6-compat; else apk add --no-cache openssl libc6-compat; fi
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
