"""Input validation utilities."""

from typing import Optional
from .exceptions import ValidationError


def validate_project_id(project_id: Optional[str]) -> None:
    """Validate project ID.
    
    Args:
        project_id: Project ID to validate
        
    Raises:
        ValidationError: If project_id is invalid
    """
    if not project_id or not isinstance(project_id, str):
        raise ValidationError("project_id must be a non-empty string")
    
    if len(project_id.strip()) == 0:
        raise ValidationError("project_id cannot be empty or whitespace")


def validate_file_area_id(file_area_id: Optional[str]) -> None:
    """Validate file area ID.
    
    Args:
        file_area_id: File area ID to validate
        
    Raises:
        ValidationError: If file_area_id is invalid
    """
    if not file_area_id or not isinstance(file_area_id, str):
        raise ValidationError("file_area_id must be a non-empty string")
    
    if len(file_area_id.strip()) == 0:
        raise ValidationError("file_area_id cannot be empty or whitespace")


def validate_folder_id(folder_id: Optional[str]) -> None:
    """Validate folder ID.
    
    Args:
        folder_id: Folder ID to validate
        
    Raises:
        ValidationError: If folder_id is invalid
    """
    if folder_id is not None and not isinstance(folder_id, str):
        raise ValidationError("folder_id must be a string or None")
    
    if folder_id and len(folder_id.strip()) == 0:
        raise ValidationError("folder_id cannot be empty or whitespace")


def validate_non_empty_string(value: Optional[str], field_name: str) -> None:
    """Validate that a string is non-empty.
    
    Args:
        value: Value to validate
        field_name: Name of the field for error messages
        
    Raises:
        ValidationError: If value is invalid
    """
    if not value or not isinstance(value, str):
        raise ValidationError(f"{field_name} must be a non-empty string")
    
    if len(value.strip()) == 0:
        raise ValidationError(f"{field_name} cannot be empty or whitespace")