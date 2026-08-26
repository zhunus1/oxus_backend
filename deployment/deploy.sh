#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

if [ ! -f .env ]; then
  echo "Missing deployment/.env file" >&2
  exit 66
fi

env_file=.env

release="${1:-}"

case "$release" in
  staging)
    export APP_RELEASE=staging
    ;;
  production)
    export APP_RELEASE=latest
    ;;
  *)
    echo "Usage: $0 {staging|production}" >&2
    exit 64
    ;;
esac

docker compose --env-file "$env_file" pull oxusedu-backend oxusedu-frontend oxusedu-frontend-admin oxusedu-frontend-expert
docker compose --env-file "$env_file" up -d --remove-orphans
docker compose --env-file "$env_file" restart oxusedu-gateway
