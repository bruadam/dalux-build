#!/usr/bin/env bash
# Search the dalux_build.ai skills library from the shell.
# Usage: ./python/scripts/skills.sh <query>
set -euo pipefail
exec python -m dalux_build.ai.skills_cli "$@"
