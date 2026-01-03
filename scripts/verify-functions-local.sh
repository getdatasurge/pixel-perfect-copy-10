#!/usr/bin/env bash
set -euo pipefail

CONFIG_TOML="supabase/config.toml"
FUNCTIONS_DIR="supabase/functions"

if [[ ! -f "$CONFIG_TOML" ]]; then
  echo "Missing $CONFIG_TOML."
  exit 1
fi

if ! python - <<'PY'
import sys
import tomllib
from pathlib import Path

config_path = Path("supabase/config.toml")
functions_dir = Path("supabase/functions")

function_dirs = sorted(
    path.name
    for path in functions_dir.iterdir()
    if path.is_dir() and path.name != "_shared"
)

if not function_dirs:
    print(f"No function directories found under {functions_dir}.")
    sys.exit(1)

with config_path.open("rb") as handle:
    data = tomllib.load(handle)

functions_config = data.get("functions", {})
errors = 0

for function_name in function_dirs:
    config = functions_config.get(function_name)
    if config is None:
        print(f"{config_path}: missing [functions.{function_name}] block.")
        errors += 1
        continue
    verify_jwt = config.get("verify_jwt")
    if verify_jwt is not False:
        print(
            f"{config_path}: [functions.{function_name}] verify_jwt must be false (found {verify_jwt!r})."
        )
        errors += 1

if errors:
    sys.exit(1)
PY
then
  printf '\nSupabase function config verification failed.\n'
  exit 1
fi

printf '\nSupabase function config verification passed.\n'
