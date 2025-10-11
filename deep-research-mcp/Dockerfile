FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx nx run deep-research-mcp:prune

FROM node:20-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist/deep-research-mcp ./
RUN npm ci --omit=dev

EXPOSE 4100
ENV PORT=4100 \
    DEEP_RESEARCH_DISABLE_PROXY=0

CMD ["node", "main.js"]
