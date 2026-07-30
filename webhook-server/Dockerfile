# Multi-stage build: keeps the runtime image free of build tooling and, more
# importantly, free of anything from the build context that isn't explicitly
# COPYd below — no .env, watchlist.json, or secrets ever end up in a layer.
FROM python:3.12-slim AS builder

WORKDIR /build
COPY pyproject.toml README.md ./
COPY dalux_webhook ./dalux_webhook

# Installs dalux-build[webhook] (fastapi/uvicorn/httpx) as a transitive
# dependency, plus this package's own console scripts.
RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.12-slim AS runtime

RUN useradd --create-home --uid 1000 dalux
COPY --from=builder /install /usr/local

WORKDIR /app
RUN mkdir -p /app/data && chown -R dalux:dalux /app
USER dalux

ENV HOST=0.0.0.0 \
    PORT=8000 \
    WATCHLIST_PATH=/app/data/watchlist.json \
    STATE_DB_PATH=/app/data/state.sqlite3 \
    DOWNLOAD_DIR=/app/data/downloads

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import os, urllib.request as u; port = os.environ.get('PORT', '8000'); u.urlopen('http://127.0.0.1:' + port + '/healthz', timeout=2)"

# CMD (not ENTRYPOINT) so `docker run <image> dalux-webhook-poll --interval 300`
# or a Compose `command:` override can run the poller from the same image
# instead of the webhook receiver — see docker-compose.yml.
CMD ["python", "-m", "dalux_webhook"]
