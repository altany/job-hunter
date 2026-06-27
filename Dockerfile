# Minimal container for the remote (HTTP) transport — used by Cloud Run.
FROM node:20-slim

WORKDIR /app

# Install production deps first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source. .dockerignore keeps secrets/local files out of the image.
COPY . .

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
# Cloud Run sets PORT at runtime; this is just the local default.
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/index.js"]
