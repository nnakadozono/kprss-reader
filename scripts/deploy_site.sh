#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Usage: scripts/deploy_site.sh [--full|--app-only|--data-only]

Modes:
  --full       Generate and deploy index.html, assets/, and data/. Default.
  --app-only   Deploy only index.html and assets/ from public/. Does not touch data/.
  --data-only  Generate and deploy only data/.
EOF
}

load_dotenv() {
  local env_file="${1:-.env}"
  [[ -f "$env_file" ]] || return 0

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    local line key value
    line="${raw_line#"${raw_line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    [[ "$line" == *"="* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"

    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ && -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$env_file"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
}

load_dotenv ".env"

MODE="full"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)
      MODE="full"
      shift
      ;;
    --app-only)
      MODE="app-only"
      shift
      ;;
    --data-only)
      MODE="data-only"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

OUT_DIR="${KPRSS_READER_OUT_DIR:-dist}"
DAYS="${KPRSS_READER_DAYS:-10}"
SITE_PREFIX="${KPRSS_READER_SITE_PREFIX:-reader/site}"
SITE_PREFIX="${SITE_PREFIX#/}"
SITE_PREFIX="${SITE_PREFIX%/}"
S3_URI="s3://${KPRSS_READER_SITE_BUCKET:-}/${SITE_PREFIX}"

require_env "KPRSS_READER_SITE_BUCKET"
require_env "KPRSS_READER_CLOUDFRONT_DISTRIBUTION_ID"

if [[ "$MODE" == "full" || "$MODE" == "data-only" ]]; then
  echo "Generating ${DAYS} days into ${OUT_DIR}..."
  python3 scripts/generate_site.py --out "$OUT_DIR" --days "$DAYS"
fi

if [[ "$MODE" == "full" || "$MODE" == "app-only" ]]; then
  echo "Deploying app files to ${S3_URI}/..."
  aws s3 cp "public/index.html" "${S3_URI}/index.html" \
    --cache-control "no-cache"

  aws s3 sync "public/assets/" "${S3_URI}/assets/" \
    --delete \
    --cache-control "public,max-age=31536000,immutable"
fi

if [[ "$MODE" == "full" || "$MODE" == "data-only" ]]; then
  echo "Deploying data files to ${S3_URI}/data/..."
  aws s3 sync "${OUT_DIR}/data/" "${S3_URI}/data/" \
    --delete \
    --cache-control "public,max-age=31536000,immutable" \
    --exclude "*" \
    --include "????-??-??.json"

  aws s3 cp "${OUT_DIR}/data/manifest.json" "${S3_URI}/data/manifest.json" \
    --cache-control "no-cache"

  aws s3 cp "${OUT_DIR}/data/latest.json" "${S3_URI}/data/latest.json" \
    --cache-control "no-cache"
fi

echo "Creating CloudFront invalidation..."
case "$MODE" in
  full)
    aws cloudfront create-invalidation \
      --distribution-id "$KPRSS_READER_CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/index.html" "/" "/data/manifest.json" "/data/latest.json"
    ;;
  app-only)
    aws cloudfront create-invalidation \
      --distribution-id "$KPRSS_READER_CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/index.html" "/" "/assets/*"
    ;;
  data-only)
    aws cloudfront create-invalidation \
      --distribution-id "$KPRSS_READER_CLOUDFRONT_DISTRIBUTION_ID" \
      --paths "/data/manifest.json" "/data/latest.json"
    ;;
esac

echo "Deploy complete."
