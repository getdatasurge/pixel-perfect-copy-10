#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="supabase/config.toml"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing $CONFIG_FILE."
  exit 1
fi

PROJECT_ID=$(awk -F '"' '/^project_id/ { print $2 }' "$CONFIG_FILE")
if [[ -z "$PROJECT_ID" ]]; then
  echo "Unable to determine project_id from $CONFIG_FILE."
  exit 1
fi

mapfile -t FUNCTIONS < <(sed -n 's/^\[functions\.\(.*\)\]$/\1/p' "$CONFIG_FILE")
if [[ ${#FUNCTIONS[@]} -eq 0 ]]; then
  echo "No functions found in $CONFIG_FILE."
  exit 1
fi

BASE_URL="https://${PROJECT_ID}.supabase.co/functions/v1"
FAILURES=0

for FUNCTION_NAME in "${FUNCTIONS[@]}"; do
  URL="${BASE_URL}/${FUNCTION_NAME}"
  echo "Checking ${FUNCTION_NAME} -> ${URL}"

  RESPONSE_HEADERS=$(curl -s -D - -o /dev/null -X OPTIONS "$URL" || true)
  if [[ -z "$RESPONSE_HEADERS" ]]; then
    echo "  ❌ No response from ${URL}"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  STATUS_CODE=$(printf "%s" "$RESPONSE_HEADERS" | head -n1 | awk '{print $2}')
  if [[ "$STATUS_CODE" != "204" ]]; then
    echo "  ❌ Expected status 204, got ${STATUS_CODE:-unknown}"
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ Status 204"
  fi

  ALLOW_ORIGIN=$(printf "%s" "$RESPONSE_HEADERS" | awk -F': ' 'tolower($1)=="access-control-allow-origin" {print $2}' | tr -d '\r')
  if [[ -z "$ALLOW_ORIGIN" ]]; then
    echo "  ❌ Missing Access-Control-Allow-Origin"
    FAILURES=$((FAILURES + 1))
  else
    echo "  ✅ Access-Control-Allow-Origin: ${ALLOW_ORIGIN}"
  fi

  ALLOW_METHODS=$(printf "%s" "$RESPONSE_HEADERS" | awk -F': ' 'tolower($1)=="access-control-allow-methods" {print $2}' | tr -d '\r' | tr '[:upper:]' '[:lower:]')
  if [[ -z "$ALLOW_METHODS" ]]; then
    echo "  ❌ Missing Access-Control-Allow-Methods"
    FAILURES=$((FAILURES + 1))
  else
    REQUIRED_METHODS=("post" "options")
    if [[ "$FUNCTION_NAME" == "search-users" ]]; then
      REQUIRED_METHODS=("get" "post" "options")
    fi
    for METHOD in "${REQUIRED_METHODS[@]}"; do
      if [[ "$ALLOW_METHODS" != *"$METHOD"* ]]; then
        echo "  ❌ Access-Control-Allow-Methods missing ${METHOD}"
        FAILURES=$((FAILURES + 1))
      fi
    done
    echo "  ✅ Access-Control-Allow-Methods: ${ALLOW_METHODS}"
  fi

  ALLOW_HEADERS=$(printf "%s" "$RESPONSE_HEADERS" | awk -F': ' 'tolower($1)=="access-control-allow-headers" {print $2}' | tr -d '\r' | tr '[:upper:]' '[:lower:]')
  if [[ -z "$ALLOW_HEADERS" ]]; then
    echo "  ❌ Missing Access-Control-Allow-Headers"
    FAILURES=$((FAILURES + 1))
  else
    REQUIRED_HEADERS=("authorization" "x-client-info" "apikey" "content-type")
    if [[ "$FUNCTION_NAME" == "ttn-webhook" || "$FUNCTION_NAME" == "ttn-webhook-forward" ]]; then
      REQUIRED_HEADERS+=("x-ttn-webhook-secret")
    fi
    for HEADER in "${REQUIRED_HEADERS[@]}"; do
      if [[ "$ALLOW_HEADERS" != *"$HEADER"* ]]; then
        echo "  ❌ Access-Control-Allow-Headers missing ${HEADER}"
        FAILURES=$((FAILURES + 1))
      fi
    done
    echo "  ✅ Access-Control-Allow-Headers: ${ALLOW_HEADERS}"
  fi

done

if [[ $FAILURES -gt 0 ]]; then
  echo "\nCORS verification failed with ${FAILURES} issue(s)."
  exit 1
fi

echo "\nCORS verification passed for ${#FUNCTIONS[@]} function(s)."
