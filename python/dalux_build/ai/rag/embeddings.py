"""LangChain embedding interface backed by the Mistral SDK."""

import math
import os
from collections.abc import Iterator

from langchain_core.embeddings import Embeddings
from mistralai.client import Mistral
from mistralai.client.utils.retries import BackoffStrategy, RetryConfig

from .vectorstore import DEFAULT_EMBEDDING_MODEL

# mistral-embed has an 8k-token context per input, and Mistral rejects a request
# whose inputs add up to too many tokens, so batches are capped by total
# characters as well as by count (~3 characters per token for Nordic text).
EMBED_BATCH = 96
EMBED_BATCH_CHARS = 32_000
MAX_EMBED_CHARS = 8000

# The SDK does not retry by default; one rate-limit response would otherwise
# abort a whole index build.
EMBED_RETRY = RetryConfig(
    "backoff",
    BackoffStrategy(
        initial_interval=1000, max_interval=30_000, exponent=2, max_elapsed_time=120_000
    ),
    retry_connection_errors=True,
)


def _batches(texts: list[str]) -> Iterator[list[str]]:
    batch: list[str] = []
    chars = 0
    for text in texts:
        text = text[:MAX_EMBED_CHARS]
        if batch and (len(batch) == EMBED_BATCH or chars + len(text) > EMBED_BATCH_CHARS):
            yield batch
            batch, chars = [], 0
        batch.append(text)
        chars += len(text)
    if batch:
        yield batch


class MistralEmbeddings(Embeddings):
    """Batch document chunks and queries through mistral-embed."""

    def __init__(self) -> None:
        api_key = os.environ.get("MISTRAL_API_KEY")
        if not api_key:
            raise ValueError("MISTRAL_API_KEY must be set for embeddings.")
        self.client = Mistral(api_key=api_key, retry_config=EMBED_RETRY)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for batch in _batches(texts):
            response = self.client.embeddings.create(model=DEFAULT_EMBEDDING_MODEL, inputs=batch)
            items = sorted(
                response.data, key=lambda item: item.index if item.index is not None else -1
            )
            if len(items) != len(batch):
                raise ValueError("Mistral returned incomplete embeddings.")
            for index, item in enumerate(items):
                if (
                    item.index != index
                    or not item.embedding
                    or not all(math.isfinite(value) for value in item.embedding)
                ):
                    raise ValueError("Mistral returned invalid embeddings.")
                vectors.append(item.embedding)
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]
