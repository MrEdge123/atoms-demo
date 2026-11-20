FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=prod-deps /app/node_modules ./node_modules

RUN node -e "const fs=require('node:fs'),p=require('node:path');for(const m of ['esbuild','lucide-react','clsx','tailwind-merge','pg','react','react-dom'])require.resolve(m);fs.accessSync(p.join(process.cwd(),'node_modules/tailwindcss/index.css'));console.log('RUNTIME_DEPS_OK');"

EXPOSE 3000
CMD ["node", "server.js"]
