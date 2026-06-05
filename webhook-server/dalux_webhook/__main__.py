"""Run the webhook server with uvicorn: ``python -m dalux_webhook``."""
from __future__ import annotations

import logging

import uvicorn

from .app import create_app
from .config import get_settings


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    app = create_app(settings)
    uvicorn.run(app, host=settings.host, port=settings.port)


if __name__ == "__main__":
    main()
