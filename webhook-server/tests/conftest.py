"""Test bootstrap.

In production the service installs ``dalux-build`` from PyPI (see
requirements.txt). When running the test suite from inside this monorepo the
package may not be installed, so fall back to the in-repo client source under
``../python`` to keep the tests runnable without an install step.
"""
import os
import sys

try:  # pragma: no cover - import side effect
    import dalux_build  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    repo_python = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "python")
    )
    if os.path.isdir(repo_python) and repo_python not in sys.path:
        sys.path.insert(0, repo_python)
