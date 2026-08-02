"""Download utilities shared between FilesApi and VersionSetsApi."""

import json
import os
from typing import TYPE_CHECKING, Protocol

from ..json_types import JSONDict

if TYPE_CHECKING:
    from ..models import File


class _ProgressBar(Protocol):
    """The subset of tqdm's interface used for download progress."""

    def update(self, n: float) -> bool | None: ...
    def close(self) -> None: ...


try:
    from tqdm import tqdm
except ImportError:
    # tqdm's own constructor signature is too large/generic to model with a
    # Protocol; the `_ProgressBar` usage below is what keeps this optional
    # dependency out of our own type surface.
    tqdm = None  # type: ignore[assignment, misc]


def get_local_file_path(file_name: str, save_path: str | None = None) -> str:
    """Build the destination file path."""
    return os.path.join(save_path, file_name) if save_path else file_name


def get_local_metadata_path(file_name: str, save_path: str | None = None) -> str:
    """Build the destination metadata path."""
    return f"{get_local_file_path(file_name, save_path)}.txt"


def load_saved_metadata(file_name: str, save_path: str | None = None) -> JSONDict | None:
    """Load previously saved metadata for a local file if present."""
    metadata_path = get_local_metadata_path(file_name, save_path)
    if not os.path.exists(metadata_path):
        return None
    try:
        with open(metadata_path, encoding="utf-8") as metadata_file:
            data = json.load(metadata_file)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def build_local_name(file_obj: "File", save_historically: bool) -> str:
    """Return the local file name, versioned by upload timestamp when requested.

    When *save_historically* is True the file's ``uploaded`` value is appended
    to the name in ``YYYYMMDDHHMMSS`` format, inserted before the extension
    (e.g. ``LLYN.B250_K01_F03_20260702000000.ifc``). Because the Dalux API
    reports ``uploaded`` with date granularity only (``yyyy-MM-dd``), the time
    portion is always zeros. Files uploaded the same day therefore share a
    timestamp and are distinguished by their revision id during the
    up-to-date check.
    """
    if not save_historically or file_obj.uploaded is None:
        return file_obj.file_name
    timestamp = file_obj.uploaded.strftime("%Y%m%d%H%M%S")
    root, ext = os.path.splitext(file_obj.file_name)
    return f"{root}_{timestamp}{ext}"


def download_file_with_metadata(
    file_obj: "File",
    *,
    save_path: str | None = None,
    save_metadata: bool = False,
    save_historically: bool = False,
    progress_label: str = "",
    verbose: bool = False,
    api_key: str | None = None,
) -> "File":
    """Download a single file (optionally versioned) and write its metadata.

    This is a shared utility function used by both FilesApi and VersionSetsApi.

    Skips the download when a matching local copy already exists (same
    ``file_revision_id`` and ``uploaded`` value). With *save_historically*
    enabled each revision is saved under its own timestamped name, so earlier
    downloads are preserved rather than overwritten and re-running only
    fetches revisions not yet present locally.

    Args:
        file_obj: The File object to download
        save_path: Optional directory to save files. Defaults to current directory.
        save_metadata: If True, write ``model_dump()`` metadata for the file
            to a sibling ``.txt`` file.
        save_historically: If True, append the file's ``uploaded`` timestamp
            (``YYYYMMDDHHMMSS``) to each downloaded file and its metadata so
            earlier revisions are kept side by side instead of overwritten.
        progress_label: Label to print for progress messages
        verbose: If True, print progress information
        api_key: The API key for authentication (required for actual download)

    Returns:
        A :class:`File` copy with ``saved_file_path`` and
        ``saved_metadata_path`` populated.

    Raises:
        AssertionError: If file_obj.download_link is None (caller must check first)
        Exception: If the download fails
    """
    import requests

    local_name = build_local_name(file_obj, save_historically)
    local_file_path = get_local_file_path(local_name, save_path)
    metadata_path = get_local_metadata_path(local_name, save_path)
    current_metadata = file_obj.model_dump(mode="json")
    saved_metadata = load_saved_metadata(local_name, save_path)

    # Check if we already have this exact revision
    if (
        saved_metadata
        and os.path.exists(local_file_path)
        and saved_metadata.get("file_revision_id") == current_metadata.get("file_revision_id")
        and saved_metadata.get("uploaded") == current_metadata.get("uploaded")
    ):
        if verbose:
            print(f"  {progress_label} {local_name!r} is still up-to-date. Skipping download.")
        return file_obj.model_copy(
            update={
                "saved_file_path": local_file_path,
                "saved_metadata_path": metadata_path,
            }
        )

    if verbose:
        print(f"  {progress_label} Downloading {local_name!r}...")

    assert file_obj.download_link is not None, "caller must check download_link first"

    # Ensure save_path exists
    if save_path:
        os.makedirs(save_path, exist_ok=True)

    temp_file_path = f"{local_file_path}.part"

    # Download the file
    headers = {"X-API-KEY": api_key} if api_key else {}
    response = requests.get(file_obj.download_link, headers=headers, stream=True)

    if response.status_code == 200:
        total_bytes_header = response.headers.get("Content-Length")
        total_bytes = (
            int(total_bytes_header) if total_bytes_header and total_bytes_header.isdigit() else None
        )
        progress: _ProgressBar | None = None
        if verbose and tqdm is not None:
            progress = tqdm(
                total=total_bytes,
                unit="B",
                unit_scale=True,
                unit_divisor=1000,
                desc=local_name,
                leave=False,
            )

        with open(temp_file_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    if progress is not None:
                        progress.update(len(chunk))
            f.flush()
            os.fsync(f.fileno())

        if progress is not None:
            progress.close()

        os.replace(temp_file_path, local_file_path)
    else:
        # Clean up temp file if it exists
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise Exception(f"Failed to download file. Status code: {response.status_code}")

    # Save metadata if requested
    written_metadata_path = None
    if save_metadata:
        written_metadata_path = get_local_metadata_path(local_name, save_path)
        with open(written_metadata_path, "w", encoding="utf-8") as metadata_file:
            json.dump(current_metadata, metadata_file, indent=2)
            metadata_file.flush()
            os.fsync(metadata_file.fileno())

    return file_obj.model_copy(
        update={
            "saved_file_path": local_file_path,
            "saved_metadata_path": written_metadata_path,
        }
    )
