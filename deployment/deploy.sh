#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

env_file=.env

if [ ! -f "$env_file" ]; then
  echo "Missing deployment/.env file" >&2
  exit 66
fi

if [ ! -s jitsi-private-key.pk ]; then
  echo "Missing or empty deployment/jitsi-private-key.pk file" >&2
  exit 66
fi

compose() {
  docker compose --env-file "$env_file" -f compose.yaml "$@"
}

compose config --quiet
compose pull
compose up -d --remove-orphans

attempt=1
max_attempts=36

while [ "$attempt" -le "$max_attempts" ]; do
  if compose exec -T backend curl -fsS http://localhost:4000/api/v1/health >/dev/null 2>&1; then
    echo "OxusEdu backend deployment is healthy."
    compose ps --all
    exit 0
  fi

  sleep 5
  attempt=$((attempt + 1))
done

echo "Backend did not become healthy within 180 seconds." >&2
compose ps --all >&2
compose logs --tail=100 backend migrator >&2
exit 1
