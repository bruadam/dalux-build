"""Standalone scheduled-monitor configuration."""

from __future__ import annotations

from dataclasses import dataclass

from dalux_build.webhook_server.config import MonitorConfig


@dataclass(frozen=True)
class Settings:
    management_token: str
    master_key: str
    dalux_base_url: str
    default_timezone: str
    state_db_path: str
    host: str
    port: int
    max_delivery_attempts: int

    @classmethod
    def from_env(cls) -> Settings:
        value = MonitorConfig.from_env()
        return cls(
            management_token=value.management_token,
            master_key=value.master_key,
            dalux_base_url=value.default_base_url,
            default_timezone=value.default_timezone,
            state_db_path=value.state_db_path,
            host=value.host,
            port=value.port,
            max_delivery_attempts=value.max_delivery_attempts,
        )

    def validate(self) -> None:
        MonitorConfig(
            management_token=self.management_token,
            master_key=self.master_key,
            default_base_url=self.dalux_base_url,
            default_timezone=self.default_timezone,
        ).validate()


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings.from_env()
    return _settings
