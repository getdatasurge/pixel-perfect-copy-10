#!/usr/bin/env bash
set -euo pipefail

CONFIG_TOML="supabase/config.toml"
FUNCTIONS_DIR="supabase/functions"

FAILURES=0

if [[ ! -f "$CONFIG_TOML" ]]; then
  echo "Missing $CONFIG_TOML."
  exit 1
fi

if ! python - <<'PY'
import sys
import tomllib
from pathlib import Path

config_path = Path("supabase/config.toml")
with config_path.open("rb") as handle:
    data = tomllib.load(handle)

functions = data.get("functions", {})
if not functions:
    print(f"No functions found in {config_path}.")
    sys.exit(1)

errors = 0
for name, config in functions.items():
    verify_jwt = config.get("verify_jwt")
    if verify_jwt is not False:
        print(f"{config_path}: [functions.{name}] verify_jwt must be false (found {verify_jwt!r}).")
        errors += 1

if errors:
    sys.exit(1)
PY
then
  FAILURES=$((FAILURES + 1))
fi

mapfile -t CONFIG_JSONS < <(find "$FUNCTIONS_DIR" -name config.json -print)

for CONFIG_JSON in "${CONFIG_JSONS[@]}"; do
  if ! python - <<PY
import json
import sys
from pathlib import Path

config_path = Path("$CONFIG_JSON")
with config_path.open("r", encoding="utf-8") as handle:
    data = json.load(handle)

verify_jwt = data.get("verify_jwt")
if verify_jwt is not False:
    print(f"{config_path}: verify_jwt must be false (found {verify_jwt!r}).")
    sys.exit(1)
PY
  then
    FAILURES=$((FAILURES + 1))
  fi
done

if [[ $FAILURES -gt 0 ]]; then
  echo "\nSupabase function config verification failed."
  exit 1
fi

echo "\nSupabase function config verification passed."
