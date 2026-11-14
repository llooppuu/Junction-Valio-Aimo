# syntax=docker/dockerfile:1.7
#
# One container serves the whole app on one port: the Express API under /api
# and the built frontend everywhere else. Configuration comes from environment
# variables (see .env.example); no .env file is copied into the image.

FROM node:22-slim AS build
WORKDIR /app

# Dependencies first, so they are cached until a package file changes.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

COPY backend backend
COPY frontend frontend
RUN npm run build
# Where the catalog and search index are built. Created here so it belongs to the app user, also as a mounted volume.
RUN mkdir -p backend/data

# Optional: build Valio Aimo's catalog into the image, so the container starts with it.
# Pass the API key as a BuildKit secret, which never ends up in an image layer:
#   docker build --secret id=valio_api_key,env=VALIO_API_KEY -t trusted-trade-agents .
# Without the secret, the container builds the catalog on its first start instead.
RUN --mount=type=secret,id=valio_api_key,required=false \
    if [ -s /run/secrets/valio_api_key ]; then VALIO_API_KEY="$(cat /run/secrets/valio_api_key)" npm run data; fi

# Optional: the index for search by meaning, from an OpenAI key passed the same way:
#   docker build --secret id=valio_api_key,env=VALIO_API_KEY --secret id=openai_api_key,env=OPENAI_API_KEY ...
RUN --mount=type=secret,id=openai_api_key,required=false \
    if [ -s /run/secrets/openai_api_key ] && [ -f backend/data/catalog.json ]; then OPENAI_API_KEY="$(cat /run/secrets/openai_api_key)" npm run embeddings; fi

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    FRONTEND_DIST=/app/frontend/dist

# The build stage's tree, including the tools `npm run data` needs if the catalog is built at start.
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Builds the catalog first if the image does not have it (needs VALIO_API_KEY), and the index for
# search by meaning when an OpenAI key is set (search falls back to keywords without it), then starts.
CMD ["sh", "-c", "([ -f backend/data/catalog.json ] || npm run data) && ([ -f backend/data/embeddings.bin ] || [ -z \"$OPENAI_API_KEY\" ] || npm run embeddings || true) && exec node backend/dist/index.js"]
