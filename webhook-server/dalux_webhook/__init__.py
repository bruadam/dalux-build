"""Webhook wrapper service for conditional Dalux Build file downloads.

The service receives Dalux file-change webhooks (or polls as a fallback),
re-confirms the change against the Dalux Build API using single-file metadata,
downloads the file only when it actually changed, writes a JSON sidecar with the
Dalux provenance next to the file, and triggers a downstream QA pipeline.
"""

__version__ = "0.1.0"
