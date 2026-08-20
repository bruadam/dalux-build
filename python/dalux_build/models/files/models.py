"""Data models for Files endpoint."""

import datetime
from datetime import date
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from ..users.models import ProjectUser

if TYPE_CHECKING:
    pass


class Reference(BaseModel):
    """Reference model."""

    key: str
    value: str

    model_config = ConfigDict(populate_by_name=True)


class FileIntegerProperty(BaseModel):
    """File integer property model."""

    integer: float | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileDateProperty(BaseModel):
    """File date property model."""

    # Annotated with `datetime.date` (not the bare `date` import) because the
    # field is also named `date`: in a class body, the `= None` default is
    # stored under the name `date` *before* the annotation `date | None` is
    # evaluated, so a bare `date | None` here resolves to `None | None` and
    # raises TypeError at class-definition time.
    date: datetime.date | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileTextProperty(BaseModel):
    """File text property model."""

    text: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileReferenceProperty(BaseModel):
    """File reference property model."""

    reference: Reference | None = None

    model_config = ConfigDict(populate_by_name=True)


class FilePropertyField(BaseModel):
    """File property field model."""

    key: str
    name: str
    values: list[JsonValue] | None = None

    model_config = ConfigDict(populate_by_name=True)


class FileNameFilter(BaseModel):
    """Case-insensitive file name filter rules with regex and wildcard support."""

    contains: list[str] | None = None
    contains_match: Literal["any", "all"] = "any"
    not_contains: list[str] | None = None
    startswith: list[str] | None = None
    not_startswith: list[str] | None = None
    endswith: list[str] | None = None
    not_endswith: list[str] | None = None
    extensions: list[str] | None = None
    not_extensions: list[str] | None = None

    # Regex pattern support
    pattern: str | None = None
    patterns: list[str] | None = None

    # Wildcard (glob) pattern support
    wildcard: str | None = None
    wildcards: list[str] | None = None

    model_config = ConfigDict(populate_by_name=True)


class MissingFileReport(BaseModel):
    """Report of missing files for a version set."""

    version_set_id: str
    missing_files: list[str] = Field(default_factory=list)
    missing_download_links: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True)


class DownloadResult(BaseModel):
    """Result of a download operation across version sets."""

    downloaded_files: list["File"] = Field(default_factory=list)
    skipped_files: list["File"] = Field(default_factory=list)
    failed_files: list[tuple["File", str]] = Field(default_factory=list)
    missing_report: dict[str, MissingFileReport] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)


class File(BaseModel):
    """File model."""

    file_id: str = Field(..., alias="fileId")
    file_revision_id: str | None = Field(None, alias="fileRevisionId")
    file_name: str = Field(..., alias="fileName")
    file_area_id: str = Field(..., alias="fileAreaId")
    folder_id: str | None = Field(None, alias="folderId")
    uploaded_by_user_id: str | None = Field(None, alias="uploadedByUserId")
    uploaded_by_user: ProjectUser | None = Field(None)
    uploaded: date | None = None
    last_modified_by_user_id: str | None = Field(None, alias="lastModifiedByUserId")
    last_modified_by_user: ProjectUser | None = Field(None)
    last_modified: date | None = Field(None, alias="lastModified")
    version: str | None = None
    deleted: bool | None = False
    file_type: str | None = Field(None, alias="fileType")
    file_size: int | None = Field(None, alias="fileSize")
    content_hash: str | None = Field(None, alias="contentHash")
    download_link: str | None = Field(None, alias="downloadLink")
    properties: list[FilePropertyField] | None = None
    saved_file_path: str | None = None
    saved_metadata_path: str | None = None

    model_config = ConfigDict(populate_by_name=True)

    def ask(
        self,
        question: str = "What is this file? Describe its content and purpose.",
        api_key: str | None = None,
        include_image_base64: bool = False,
    ) -> str:
        """Analyze the file content using AI providers.

        Downloads the file and sends it to Claude (via AI provider system) for analysis.
        Uses the configured AI provider (Anthropic, Mistral, OpenAI, OpenRouter).

        Args:
            question: The question to ask about the file content.
            api_key: Optional API key for Dalux authentication. If not provided, reads from
                DALUX_API_KEY environment variable.
            include_image_base64: If True, includes the image base64 in the Mistral OCR request
                to get encoded images in the response.

        Returns:
            AI analysis of the file.

        Raises:
            ValueError: If download_link is not available or api_key cannot be found.
            ImportError: If required packages are not installed.
        """
        if not self.download_link:
            raise ValueError(f"Cannot analyze file '{self.file_name}': download_link not available")

        try:
            import base64
            import os

            import requests
        except ImportError as e:
            raise ImportError(
                "Required packages missing. Install with: pip install requests"
            ) from e

        # Get Dalux API key for file download
        if api_key is None:
            api_key = os.getenv("DALUX_API_KEY")
            if not api_key:
                raise ValueError(
                    "API key required. Pass api_key parameter or set "
                    "DALUX_API_KEY environment variable"
                )

        # Download file with authentication
        headers = {"X-API-KEY": api_key}
        response = requests.get(self.download_link, headers=headers)
        response.raise_for_status()
        file_content = response.content

        # Determine media type
        media_type_map = {
            "pdf": "application/pdf",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "webp": "image/webp",
        }
        file_ext = self.file_name.split(".")[-1].lower()
        media_type = media_type_map.get(file_ext, "application/octet-stream")

        # Use AI provider system
        from ...ai.config import ProviderConfig
        from ...ai.providers import ProviderType

        try:
            provider_config = ProviderConfig.create_provider_from_env(
                provider=None, model=None, interactive=True
            )
        except ValueError as e:
            raise ImportError(f"AI provider not configured: {e}") from e

        # Handle PDFs with OCR if using Mistral
        extracted_text = None
        page_images = []
        if file_ext == "pdf" and provider_config.provider == ProviderType.MISTRAL:
            try:
                from mistralai.client import Mistral
            except ImportError as e:
                raise ImportError(
                    "Mistral package required for PDF OCR. Install with: pip install mistralai"
                ) from e

            print("📄 Extracting text from PDF using Mistral OCR...")
            client = Mistral(api_key=provider_config.api_key)
            b64_content = base64.standard_b64encode(file_content).decode("utf-8")

            # Use Mistral's dedicated OCR API with data URI
            ocr_response = client.ocr.process(
                model="mistral-ocr-latest",
                document={
                    "type": "document_url",
                    "document_url": f"data:application/pdf;base64,{b64_content}",
                },
                include_image_base64=include_image_base64,
            )

            # Extract markdown text from all pages
            extracted_text = "\n\n".join(page.markdown for page in ocr_response.pages)
            print(  # noqa: E501
                f"✓ Text extracted from {len(ocr_response.pages)} pages "
                f"({len(extracted_text)} chars)"
            )

            # Extract images if requested
            if include_image_base64:
                page_images = [
                    page.image
                    for page in ocr_response.pages
                    if hasattr(page, "image") and page.image
                ]  # noqa: E501
                if page_images:
                    print(f"✓ Extracted {len(page_images)} page images")

        # Send to AI provider for analysis
        if provider_config.provider == ProviderType.ANTHROPIC:
            try:
                from anthropic import Anthropic
            except ImportError as e:
                raise ImportError(
                    "Anthropic package required. Install with: pip install anthropic"
                ) from e

            client = Anthropic(api_key=provider_config.api_key)

            if extracted_text and not include_image_base64:
                # Use extracted text from OCR only
                content: list[dict[str, Any]] = [
                    {
                        "type": "text",
                        "text": f"File: {self.file_name}\n\nExtracted content:\n\n{extracted_text}\n\nQuestion: {question}",  # noqa: E501
                    }
                ]
            elif extracted_text and include_image_base64 and page_images:
                # Use extracted text + page images from Mistral OCR
                content = [
                    {
                        "type": "text",
                        "text": f"File: {self.file_name}\n\nExtracted content:\n\n{extracted_text}\n\nQuestion: {question}",  # noqa: E501
                    }
                ]
                # Add page images
                for _i, img_b64 in enumerate(page_images):
                    content.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": img_b64,
                            },
                        }
                    )
            elif extracted_text and include_image_base64:
                # Extracted text available but no images from OCR
                content = [
                    {
                        "type": "text",
                        "text": f"File: {self.file_name}\n\nExtracted content:\n\n{extracted_text}\n\nQuestion: {question}",  # noqa: E501
                    }
                ]
            else:
                # Use multimodal for images/PDFs (no OCR)
                b64_content = base64.standard_b64encode(file_content).decode("utf-8")
                content = [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64_content,
                        },
                    },
                    {
                        "type": "text",
                        "text": f"File name: {self.file_name}\n\n{question}",
                    },
                ]

            response = client.messages.create(
                model=provider_config.model,
                max_tokens=2048,
                messages=[{"role": "user", "content": content}],
            )

            return response.content[0].text if response.content else ""
        else:
            # For other providers, use extracted text or file metadata
            if extracted_text:
                prompt = f"File: {self.file_name}\n\nExtracted content:\n\n{extracted_text}\n\nQuestion: {question}"  # noqa: E501
            else:
                file_size_kb = len(file_content) / 1024
                prompt = (
                    f"File: {self.file_name}\n"
                    f"Type: {media_type}\n"
                    f"Size: {file_size_kb:.1f} KB\n\n"
                    f"{question}"
                )
            return provider_config.call(prompt, max_tokens=2048)
