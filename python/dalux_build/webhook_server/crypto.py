"""Encryption of credentials persisted by monitor jobs."""

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    def __init__(self, key: str) -> None:
        if not key:
            raise ValueError("MONITOR_MASTER_KEY is required")
        try:
            self._fernet = Fernet(key.encode("ascii"))
        except (ValueError, UnicodeEncodeError) as exc:
            raise ValueError("MONITOR_MASTER_KEY must be a valid Fernet key") from exc

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode("ascii")

    def decrypt(self, value: str) -> str:
        try:
            return self._fernet.decrypt(value.encode("ascii")).decode()
        except InvalidToken as exc:
            raise ValueError(
                "stored credential cannot be decrypted with MONITOR_MASTER_KEY"
            ) from exc
