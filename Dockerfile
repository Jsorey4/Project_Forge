# ProjectForge production image: one container serves the built React app and the FastAPI API.
# Team: eLeet Coderz (Team 3). Traces: SE-NFR-06 (HTTPS is terminated by the host; see docker-compose.yml).

# Stage 1: build the web app.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: backend plus the built web files.
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist web/dist

WORKDIR /app/backend
# --proxy-headers: the host terminates TLS, so trust X-Forwarded-Proto for the HTTPS-redirect middleware
# (otherwise every request would redirect in a loop). uvicorn trusts forwarded headers only from the
# addresses in FORWARDED_ALLOW_IPS (default 127.0.0.1,::1); docker-compose.yml sets it to the Compose network.
# Never use "*": uvicorn would then take the left-most X-Forwarded-For entry, which the client controls, and
# the per-IP rate limit could be dodged.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers"]
