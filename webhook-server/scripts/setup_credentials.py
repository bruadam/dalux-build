"""Generate and persist the Docker Compose monitor credentials."""

from __future__ import annotations

import argparse
import base64
import os
import secrets
import sys
from pathlib import Path

TOKEN_KEY = "MONITOR_API_TOKEN"
MASTER_KEY = "MONITOR_MASTER_KEY"
PLACEHOLDER_PREFIX = "replace-with-"


def _read_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def _usable(value: str | None) -> bool:
    return bool(value and not value.startswith(PLACEHOLDER_PREFIX))


def _replace_values(path: Path, replacements: dict[str, str]) -> None:
    owner = path.stat() if path.exists() else path.parent.stat()
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = dict(replacements)
    updated: list[str] = []
    for line in lines:
        key = line.split("=", 1)[0].strip() if "=" in line else ""
        if key in remaining and not line.lstrip().startswith("#"):
            updated.append(f"{key}={remaining.pop(key)}")
        else:
            updated.append(line)
    if remaining and updated and updated[-1]:
        updated.append("")
    updated.extend(f"{key}={value}" for key, value in remaining.items())

    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text("\n".join(updated) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    if os.geteuid() == 0:
        os.chown(path, owner.st_uid, owner.st_gid)


def _write_secret(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    owner = path.stat() if path.exists() else path.parent.stat()
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(value + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    os.chmod(path, 0o600)
    if os.geteuid() == 0:
        os.chown(path, owner.st_uid, owner.st_gid)


def setup(env_file: Path, secrets_dir: Path, *, assume_saved: bool, quiet: bool) -> int:
    values = _read_values(env_file)
    token = values.get(TOKEN_KEY)
    master_key = values.get(MASTER_KEY)
    generated = False

    if not _usable(token):
        token = secrets.token_urlsafe(32)
        generated = True
    if not _usable(master_key):
        master_key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
        generated = True

    assert token is not None
    assert master_key is not None
    _replace_values(
        env_file,
        {
            TOKEN_KEY: token,
            MASTER_KEY: master_key,
        },
    )
    _write_secret(secrets_dir / "monitor_api_token.txt", token)
    _write_secret(secrets_dir / "monitor_master_key.txt", master_key)

    if quiet:
        return 0

    action = "Generated credentials" if generated else "Existing credentials"
    print(f"\n{action} saved to {env_file} and synchronized to {secrets_dir} (permissions: 0600).")
    print("\nSave these values in your password manager now:\n")
    print(f"{TOKEN_KEY}={token}")
    print(f"{MASTER_KEY}={master_key}")
    print("\nThe API token authenticates management requests.")
    print("The master key is required to decrypt all persisted Dalux and callback secrets.")
    print("Losing or replacing the master key makes existing jobs unusable.\n")

    if assume_saved:
        return 0
    try:
        confirmation = input("Type SAVED after storing both credentials: ").strip()
    except EOFError:
        confirmation = ""
    if confirmation != "SAVED":
        message = f"Credentials remain safely stored in {env_file}; setup not confirmed."
        print(message, file=sys.stderr)
        return 1
    print("Credentials confirmed. You can now run: docker compose up --build -d")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, default=Path("/workspace/.env"))
    parser.add_argument("--secrets-dir", type=Path, default=Path("/workspace/secrets"))
    parser.add_argument("--yes", action="store_true", help="skip the saved-credentials prompt")
    parser.add_argument("--quiet", action="store_true", help="do not print credential values")
    args = parser.parse_args()
    return setup(args.env_file, args.secrets_dir, assume_saved=args.yes, quiet=args.quiet)


if __name__ == "__main__":
    raise SystemExit(main())
