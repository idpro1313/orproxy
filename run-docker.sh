#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo "orproxy: нет файла .env — скопируйте .env.example в .env и задайте OPENROUTER_API_KEY" >&2
  exit 1
fi
exec docker compose up --build "$@"
