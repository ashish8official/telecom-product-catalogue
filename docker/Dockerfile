# Catalogue API image. Build from the repository root:
#   docker build -f docker/Dockerfile -t product-catalogue .
FROM node:22-alpine

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY backend/ ./
COPY database/ /app/database/
COPY frontend/ /app/frontend/

RUN npx tsc --noEmit -p . && chown -R node:node /app
USER node

ENV NODE_ENV=development PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/ready || exit 1

# Apply pending migrations, then serve.
CMD ["sh", "-c", "npm run -s db:migrate && exec npx ts-node --transpile-only server.ts"]
