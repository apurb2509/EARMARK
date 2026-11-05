FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts
COPY --from=builder /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
