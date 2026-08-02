"""Resource-scoped dashboard template registry."""

from dataclasses import dataclass

from .errors import DashboardTemplateNotFoundError


@dataclass(frozen=True)
class DashboardTemplate:
    """Metadata needed to load a dashboard template in the Streamlit process."""

    resource: str
    name: str
    display_name: str
    description: str
    module: str
    renderer: str = "render"


_TEMPLATES: dict[tuple[str, str], DashboardTemplate] = {}


def register_template(template: DashboardTemplate) -> None:
    """Register a dashboard template for one API resource."""
    key = (template.resource, template.name)
    if key in _TEMPLATES:
        raise ValueError(
            f"Dashboard template '{template.name}' is already registered "
            f"for resource '{template.resource}'"
        )
    _TEMPLATES[key] = template


def list_templates(resource: str) -> tuple[DashboardTemplate, ...]:
    """Return templates registered for a resource, sorted by name."""
    return tuple(
        sorted(
            (template for template in _TEMPLATES.values() if template.resource == resource),
            key=lambda template: template.name,
        )
    )


def get_template(resource: str, name: str) -> DashboardTemplate:
    """Resolve a template or raise a resource-specific error."""
    template = _TEMPLATES.get((resource, name))
    if template is not None:
        return template

    available = ", ".join(item.name for item in list_templates(resource)) or "none"
    raise DashboardTemplateNotFoundError(
        f"Dashboard template '{name}' is not available for resource '{resource}'. "
        f"Available templates: {available}."
    )


register_template(
    DashboardTemplate(
        resource="tasks",
        name="task-timeline",
        display_name="Task timeline",
        description="Task lifecycle events, deadlines, and current state.",
        module="dalux_build.dashboards.templates.task_timeline",
    )
)
