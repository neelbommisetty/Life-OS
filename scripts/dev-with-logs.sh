#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to run dev services." >&2
  exit 1
fi

MODE="${1:-all}"
TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"

declare -a SERVICE_PIDS=()
declare -a LOGGER_PIDS=()
declare -a SERVICE_NAMES=()
declare -a FIFOS=()
TAIL_PID=""

cleanup() {
  trap - EXIT INT TERM

  terminate_pid() {
    local pid="$1"
    [ -n "$pid" ] || return 0
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" >/dev/null 2>&1 || true
  }

  for pid in "${SERVICE_PIDS[@]+"${SERVICE_PIDS[@]}"}"; do
    terminate_pid "$pid"
  done

  for pid in "${LOGGER_PIDS[@]+"${LOGGER_PIDS[@]}"}"; do
    terminate_pid "$pid"
  done

  if [ -n "$TAIL_PID" ]; then
    terminate_pid "$TAIL_PID"
  fi

  for fifo in "${FIFOS[@]+"${FIFOS[@]}"}"; do
    [ -n "$fifo" ] || continue
    rm -f "$fifo"
  done
}

trap cleanup EXIT INT TERM

case "$MODE" in
  all | web | api) ;;
  *)
    echo "Invalid mode: $MODE" >&2
    echo "Usage: bash ./scripts/dev-with-logs.sh [all|web|api]" >&2
    exit 1
    ;;
esac

LOG_FILE="${LIFE_OS_DEV_LOG_FILE:-$(mktemp "$TMP_BASE/life-os-dev.XXXXXX")}"

printf "Dev logs: %s\n" "$LOG_FILE"
printf "Tip: set LIFE_OS_DEV_LOG_FILE to reuse a fixed path.\n"

: > "$LOG_FILE"
tail -n +1 -F "$LOG_FILE" &
TAIL_PID="$!"

start_service() {
  local name="$1"
  shift

  local fifo
  fifo="$TMP_BASE/life-os-dev-${name}.$$.$RANDOM.fifo"
  while [ -e "$fifo" ]; do
    fifo="$TMP_BASE/life-os-dev-${name}.$$.$RANDOM.fifo"
  done
  mkfifo "$fifo"
  FIFOS+=("$fifo")

  awk -v name="$name" '
    {
      cmd = "date +\"%Y-%m-%d %H:%M:%S\""
      cmd | getline ts
      close(cmd)
      printf "[%s] [%s] %s\n", ts, name, $0
      fflush()
    }
  ' < "$fifo" >> "$LOG_FILE" &
  LOGGER_PIDS+=("$!")

  "$@" > "$fifo" 2>&1 &
  SERVICE_PIDS+=("$!")
  SERVICE_NAMES+=("$name")
}

case "$MODE" in
  all)
    start_service "web" bun --filter=./apps/web dev
    start_service "api" bun --filter=./apps/api dev
    ;;
  web)
    start_service "web" bun --filter=./apps/web dev
    ;;
  api)
    start_service "api" bun --filter=./apps/api dev
    ;;
esac

while true; do
  index=0
  for pid in "${SERVICE_PIDS[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      if wait "$pid"; then
        exit_code=0
      else
        exit_code=$?
      fi
      service="${SERVICE_NAMES[$index]}"
      if [ "$exit_code" -ne 0 ]; then
        printf "[%s] [dev-runner] Service '%s' exited with code %s\n" \
          "$(date +"%Y-%m-%d %H:%M:%S")" "$service" "$exit_code" >> "$LOG_FILE"
      fi
      exit "$exit_code"
    fi
    index=$((index + 1))
  done
  sleep 1
done
