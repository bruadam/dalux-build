"""Utilities for mapping ID fields to objects in API responses."""

from typing import Any, TypeVar

from ..models import ProjectCompany, ProjectUser

T = TypeVar("T")


def create_user_mapping(users: list[ProjectUser]) -> dict[str, ProjectUser]:
    """Create a mapping of user_id to ProjectUser objects.

    Args:
        users: List of ProjectUser objects.

    Returns:
        Dictionary mapping user_id (str) to ProjectUser object.
    """
    return {user.user_id: user for user in users}


def create_company_mapping(companies: list[ProjectCompany]) -> dict[str, ProjectCompany]:
    """Create a mapping of company_id to ProjectCompany objects.

    Args:
        companies: List of ProjectCompany objects.

    Returns:
        Dictionary mapping company_id (str) to ProjectCompany object.
    """
    return {c.company_id: c for c in companies if c.company_id}


def enrich_response_with_users(
    response: Any,  # noqa: ANN401
    user_mapping: dict[str, ProjectUser],
    field_mappings: dict[str, str],
) -> Any:  # noqa: ANN401
    """Enrich raw API response by replacing id strings with objects.

    Recursively traverses the response structure and replaces specified ID
    fields with objects from the mapping. Supports nested items, lists, and
    any depth of nesting.

    Args:
        response: Raw API response (dict, list, or primitive).
        user_mapping: Mapping of ID to object (e.g., user_id → ProjectUser).
        field_mappings: Dict mapping ID field names to their corresponding
            object field names (e.g., {"userId": "user", "companyId": "company"}).

    Returns:
        Response with ID fields replaced by objects.
    """
    if isinstance(response, dict):
        result = {}
        for key, value in response.items():
            # If this key is a field mapping and value is a string ID in mapping
            if key in field_mappings and isinstance(value, str) and value in user_mapping:
                result[key] = user_mapping[value]
                result[field_mappings[key]] = user_mapping[value]
            else:
                result[key] = enrich_response_with_users(value, user_mapping, field_mappings)
        return result
    elif isinstance(response, list):
        return [enrich_response_with_users(item, user_mapping, field_mappings) for item in response]
    else:
        return response
