# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Temporary dependency diagnostics: keep this until the Coolify build confirms
# the lockfile contains every optional @emnapi package needed by sharp/Tailwind.
RUN echo '--- package.json ---' && cat package.json && \
    echo '--- @emnapi/sharp lock entries ---' && \
    node -e "const l=require('./package-lock.json'); for(const [k,v] of Object.entries(l.packages||{})){if(k.includes('@emnapi')||k.includes('sharp-wasm32')) console.log(k, JSON.stringify({version:v.version,resolved:v.resolved,dependencies:v.dependencies,optionalDependencies:v.optionalDependencies}, null, 2));}"
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN echo '--- package.json ---' && cat package.json && \
    echo '--- @emnapi/sharp lock entries ---' && \
    node -e "const l=require('./package-lock.json'); for(const [k,v] of Object.entries(l.packages||{})){if(k.includes('@emnapi')||k.includes('sharp-wasm32')) console.log(k, JSON.stringify({version:v.version,resolved:v.resolved,dependencies:v.dependencies,optionalDependencies:v.optionalDependencies}, null, 2));}"
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/live || exit 1

CMD ["node", "server.js"]
