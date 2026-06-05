"""Compute next package version for GitHub Actions (stdout: KEY=value lines)."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path


def read_pyproject_version(repo_root: Path) -> tuple[int, int, int]:
    text = (repo_root / "python" / "pyproject.toml").read_text(encoding="utf-8")
    m = re.search(r'^version = "([^"]+)"', text, re.MULTILINE)
    if not m:
        sys.exit("python/pyproject.toml: missing version line")
    cur = m.group(1)
    if not re.fullmatch(r"\d+\.\d+\.\d+", cur):
        sys.exit(f"python/pyproject.toml: expected X.Y.Z version, got {cur!r}")
    return tuple(int(x) for x in cur.split("."))


def read_package_json_version(repo_root: Path) -> tuple[int, int, int]:
    path = repo_root / "package.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    cur = data.get("version")
    if not cur or not isinstance(cur, str):
        sys.exit("package.json: missing or invalid version")
    if not re.fullmatch(r"\d+\.\d+\.\d+", cur):
        sys.exit(f"package.json: expected X.Y.Z version, got {cur!r}")
    return tuple(int(x) for x in cur.split("."))


def read_current_version(repo_root: Path, target: str) -> tuple[int, int, int]:
    if target == "python":
        return read_pyproject_version(repo_root)
    if target == "npm":
        return read_package_json_version(repo_root)
    if target == "dual":
        # max semver of Python + npm manifests (npm publish uses same bump rules as Python)
        pt = read_pyproject_version(repo_root)
        nt = read_package_json_version(repo_root)
        return max(pt, nt, key=lambda t: t)
    sys.exit(f"Unknown GHA_TARGET={target!r}")


def emit(**kwargs: str) -> None:
    for k, v in kwargs.items():
        print(f"{k}={v}")


def main() -> None:
    repo_root = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()
    mode = os.environ["GHA_MODE"]
    target = os.environ.get("GHA_TARGET", "python")
    if target not in ("python", "npm", "dual"):
        sys.exit(f"GHA_TARGET must be python, npm, or dual, got {target!r}")

    if mode == "dispatch":
        ma, mi, pa = read_current_version(repo_root, target)
        bump = os.environ.get("INPUT_BUMP", "patch")
        if bump == "major":
            ma, mi, pa = ma + 1, 0, 0
        elif bump == "minor":
            mi, pa = mi + 1, 0
        else:
            pa = pa + 1
        ver = f"{ma}.{mi}.{pa}"
        emit(version=ver, tag=f"v{ver}", skip="false", bump="true")
        return

    if mode != "auto":
        sys.exit(f"Unknown GHA_MODE={mode!r}")

    msg = os.environ.get("COMMIT_MESSAGE", "")
    if target == "python" and "[skip pypi]" in msg:
        emit(skip="true", bump="false")
        return
    if target in ("npm", "dual") and "[skip npm]" in msg:
        emit(skip="true", bump="false")
        return

    ma, mi, pa = read_current_version(repo_root, target)
    cur_t = (ma, mi, pa)

    new: str | None = None
    m = re.search(r"\bv(\d+)\.(\d+)\.(\d+)\b", msg)
    if m:
        new = f"{m.group(1)}.{m.group(2)}.{m.group(3)}"
    else:
        m = re.search(r"\bv(\d+)\.(\d+)\b", msg)
        if m:
            new = f"{m.group(1)}.{m.group(2)}.0"

    if new is None:
        new = f"{ma}.{mi}.{pa + 1}"
    else:
        nt = tuple(int(x) for x in new.split("."))
        if nt <= cur_t:
            new = f"{ma}.{mi}.{pa + 1}"

    emit(version=new, tag=f"v{new}", skip="false", bump="true")


if __name__ == "__main__":
    main()
