"""Resolve which Dalux file_area/folder a RAG agent should index."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import TYPE_CHECKING

from ...models import File, FileNameFilter
from ...utils.file_filter import filter_files_by_name
from ...utils.validation import resolve_file_area_id, resolve_project_id
from .errors import AgentScopeError

if TYPE_CHECKING:
    from ... import DaluxClient


@dataclass(frozen=True)
class AgentScope:
    """A resolved (project, file_area, optional folder) scope for a RAG agent."""

    project_id: str
    file_area_id: str
    folder_id: str | None = None

    def cache_key(self) -> str:
        """Stable identifier for this scope, used as the on-disk cache/collection name."""
        raw = f"{self.project_id}:{self.file_area_id}:{self.folder_id or ''}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def to_env(self) -> dict[str, str]:
        """Serialize this scope for handing to a subprocess via environment variables."""
        env = {
            "DALUX_AGENT_PROJECT_ID": self.project_id,
            "DALUX_AGENT_FILE_AREA_ID": self.file_area_id,
        }
        if self.folder_id:
            env["DALUX_AGENT_FOLDER_ID"] = self.folder_id
        return env


def resolve_scope(
    client: DaluxClient,
    *,
    file_area_id: str | None = None,
    folder_id: str | None = None,
    path: str | None = None,
    project_id: str | None = None,
) -> AgentScope:
    """Resolve a file_area/folder scope from an id, a path, or client defaults.

    Pass at most one of *folder_id* / *path*. When *path* is given (e.g.
    ``"Files/4_Design/Contracts"``), the file area is resolved from the
    path's first segment and does not need to be passed separately.
    """
    resolved_project_id = resolve_project_id(project_id, client.configuration.project_id)

    if folder_id is not None and path is not None:
        raise AgentScopeError("Pass either folder_id or path, not both.")

    if path is not None:
        file_area_name = path.strip("/").split("/", 1)[0]
        resolved_file_area_id = client.file_areas.get_file_area_by_name(
            file_area_name, project_id=resolved_project_id
        )
        if not resolved_file_area_id:
            raise AgentScopeError(f"No file area named {file_area_name!r} found for {path!r}.")

        folder_response = client.folders.get_folder_by_path(path, project_id=resolved_project_id)
        if folder_response is None:
            raise AgentScopeError(f"No folder found at path {path!r}.")

        return AgentScope(
            project_id=resolved_project_id,
            file_area_id=resolved_file_area_id,
            folder_id=folder_response.data.folder_id,
        )

    resolved_file_area_id = resolve_file_area_id(file_area_id, client.configuration.file_area_id)
    return AgentScope(
        project_id=resolved_project_id,
        file_area_id=resolved_file_area_id,
        folder_id=folder_id,
    )


_EXCLUDED_FILE_TYPES = frozenset({"drawing"})


def resolve_pdf_files(
    client: DaluxClient,
    scope: AgentScope,
    *,
    recursive: bool = True,
    file_type: str | None = "document",
    verbose: bool = False,
) -> list[File]:
    """List the PDF files in *scope*, filtered by filename extension and file_type.

    There is no server-side "document"/file_type query parameter, so PDFs
    are identified by extension (via ``FileNameFilter``), then filtered by
    ``File.file_type`` client-side. Drawings (``file_type == "drawing"``)
    are always excluded, regardless of *file_type*. By default only
    ``file_type == "document"`` PDFs are kept; pass ``file_type=None`` to
    disable that filter and keep every non-drawing PDF instead.
    """
    if scope.folder_id is not None:
        raw_files = client.files.get_files_in_folder(
            folder_id=scope.folder_id,
            project_id=scope.project_id,
            file_area_id=scope.file_area_id,
            subfolders=recursive,
            verbose=verbose,
        )
    else:
        raw_files = client.files.get_files(
            project_id=scope.project_id,
            file_area_id=scope.file_area_id,
            recursively_populate=False,
            verbose=verbose,
        )

    files = [item for item in raw_files if isinstance(item, File)]
    pdf_filter = FileNameFilter(extensions=[".pdf"])
    pdf_files = filter_files_by_name(
        files, pdf_filter, name_getter=lambda f: f.file_name, verbose=verbose
    )

    pdf_files = [f for f in pdf_files if f.file_type not in _EXCLUDED_FILE_TYPES]
    if file_type:
        pdf_files = [f for f in pdf_files if f.file_type == file_type]

    return pdf_files
