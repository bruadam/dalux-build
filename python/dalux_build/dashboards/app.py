"""Streamlit entry point used by the dashboard subprocess."""

import importlib
import json
import os
from typing import Protocol, cast

from dalux_build import DaluxClient, create_client
from dalux_build.dashboards.registry import get_template
from dalux_build.json_types import JSONDict


class DashboardRenderer(Protocol):
    """Callable contract implemented by dashboard templates."""

    def __call__(self, client: DaluxClient, options: JSONDict) -> None: ...


def _required_environment(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing dashboard environment setting: {name}")
    return value


def main() -> None:
    """Resolve and render the selected resource dashboard."""
    resource = _required_environment("DALUX_DASHBOARD_RESOURCE")
    template_name = _required_environment("DALUX_DASHBOARD_TEMPLATE")
    raw_options = os.getenv("DALUX_DASHBOARD_OPTIONS", "{}")
    decoded_options: object = json.loads(raw_options)
    if not isinstance(decoded_options, dict):
        raise ValueError("DALUX_DASHBOARD_OPTIONS must contain a JSON object")
    options = cast(JSONDict, decoded_options)

    client = create_client()
    template = get_template(resource, template_name)
    module = importlib.import_module(template.module)
    renderer = cast(DashboardRenderer, getattr(module, template.renderer))
    renderer(client, options)


main()
