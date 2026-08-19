"""Utilities for mapping ID fields to objects in API responses."""

from typing import Any, TypeVar

from ..models import ProjectCompany, ProjectUser

T = TypeVar("T")
ObjectT = TypeVar("ObjectT")  # Generic object type for any mapping


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


def enrich_users_with_companies(
    response: Any,  # noqa: ANN401
    company_mapping: dict[str, ProjectCompany],
) -> Any:  # noqa: ANN401
    """Enrich user dicts within a response by adding company objects.

    Recursively traverses the response dict and enriches user dicts by
    adding their company object using the company_mapping.

    Args:
        response: Raw dict response with user objects.
        company_mapping: Mapping of company_id to ProjectCompany objects.

    Returns:
        Response with company field added to user dicts.
    """
    if isinstance(response, dict):
        result = dict(response)
        # Check if this dict represents a user (has user_id and company_id fields)
        if "user_id" in response and "company_id" in response:
            company_id = response.get("company_id")
            if company_id and company_id in company_mapping:
                company_obj = company_mapping[company_id]
                company_dict = (
                    company_obj.model_dump(by_alias=False)
                    if hasattr(company_obj, "model_dump")
                    else company_obj
                )
                result["company"] = company_dict
        # Recursively enrich nested structures
        for k, v in response.items():
            if isinstance(v, (dict, list)):
                result[k] = enrich_users_with_companies(v, company_mapping)
        return result
    elif isinstance(response, list):
        return [enrich_users_with_companies(item, company_mapping) for item in response]
    else:
        return response


def enrich_response_with_users(
    response: Any,  # noqa: ANN401
    mapping: dict[str, Any],  # noqa: ANN401
    field_mappings: dict[str, str],
) -> Any:  # noqa: ANN401
    """Enrich raw API response by adding object dicts alongside ID fields.

    Recursively traverses the response structure and adds object dicts from
    the mapping alongside specified ID fields. Keeps original ID fields.
    Supports nested items, lists, and any depth of nesting.

    Args:
        response: Raw API response (dict, list, or primitive).
        mapping: Mapping of ID to object (e.g., user_id → ProjectUser or
            company_id → ProjectCompany).
        field_mappings: Dict mapping ID field names to their corresponding
            object field names (e.g., {"userId": "user", "companyId": "company"}).

    Returns:
        Response with object dicts added alongside ID fields.
    """
    if isinstance(response, dict):
        result = dict(response)  # Preserve original fields
        for key, value in response.items():
            # If this key is a field mapping and value is a string ID in mapping
            if key in field_mappings and isinstance(value, str) and value in mapping:
                # Add the enriched object as dict alongside the ID field
                obj = mapping[value]
                obj_dict = obj.model_dump(by_alias=False) if hasattr(obj, "model_dump") else obj
                result[field_mappings[key]] = obj_dict
            elif isinstance(value, (dict, list)):
                # Recursively enrich nested structures
                result[key] = enrich_response_with_users(value, mapping, field_mappings)
        return result
    elif isinstance(response, list):
        return [enrich_response_with_users(item, mapping, field_mappings) for item in response]
    else:
        return response
