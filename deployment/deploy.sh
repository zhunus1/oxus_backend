#!/usr/bin/env bash
# Installed once on each server; CI passes only an environment and immutable image.
set -Eeuo pipefail
umask 077

if [[ $# != 2 || ! $1 =~ ^(test|production)$ || ! $2 =~ ^ghcr\.io/zhunus1/oxus_backend@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Usage: deploy.sh test|production ghcr.io/zhunus1/oxus_backend@sha256:<64 hex characters>' >&2
  exit 64
fi
[[ $EUID == 0 ]] || { echo 'Run through sudo on the server.' >&2; exit 77; }
deploy_environment=$1
export BACKEND_IMAGE=$2
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"
[[ -f .env && -s jitsi-private-key.pk ]]
command -v python3 >/dev/null
command -v flock >/dev/null
command -v sha256sum >/dev/null
python3 - <<'PY'
from pathlib import Path
import re
if len(re.findall(r'(?m)^(?:export\s+)?BACKEND_IMAGE\s*=', Path('.env').read_text())) > 1:
    raise SystemExit('Duplicate BACKEND_IMAGE definitions in .env')
PY

# Neither another SSH session nor an interrupted Actions job may overlap migrations.
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is already running.' >&2; exit 75; }
trap '' HUP
compose_args=(--project-name oxus_backend --env-file .env -f compose.yaml)
if [[ -f compose.override.yaml ]]; then compose_args+=(-f compose.override.yaml); fi
compose() { docker compose "${compose_args[@]}" "$@"; }
compose config --quiet
compose config --format json | python3 -c '
import json,sys
mode=json.load(sys.stdin)["services"]["backend"]["environment"].get("FREEDOM_TESTING_MODE")
if mode not in ("0", "1"):
    sys.exit("FREEDOM_TESTING_MODE must be explicitly passed as 0 or 1.")
'
staging=$(compose config --format json | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["services"]["backend"]["environment"]["STAGING"]).lower())')
if [[ $deploy_environment == production ]]; then
  [[ $staging == false ]] || { echo 'Production requires STAGING=false.' >&2; exit 78; }
else
  [[ $staging == true ]] || { echo 'Test requires STAGING=true.' >&2; exit 78; }
fi
existing_migrator=$(compose ps -a -q migrator)
if [[ -n $existing_migrator && $(docker inspect -f '{{.State.Running}}' "$existing_migrator") == true ]]; then
  echo 'A migration container is still running. Inspect it before retrying deployment.' >&2
  exit 75
fi

# Pull before stopping the existing application. Infrastructure images are unchanged.
compose pull backend migrator
previous_container=$(compose ps -a -q backend)
[[ -n $previous_container ]] || { echo 'Initialize the server stack before enabling CI deployments.' >&2; exit 78; }
for service in db redis minio chrome; do
  container=$(compose ps -q "$service")
  [[ -n $container && $(docker inspect -f '{{.State.Running}}' "$container") == true ]]
done

mkdir -p /var/backups
release_dir=$(mktemp -d "/var/backups/oxus-release-${deploy_environment}-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
configuration=(.env compose.yaml deploy.sh jitsi-private-key.pk)
if [[ -f compose.override.yaml ]]; then configuration+=(compose.override.yaml); fi
tar -czf "$release_dir/configuration.tar.gz" "${configuration[@]}"
docker inspect -f '{{.Config.Image}} {{.Image}}' "$previous_container" > "$release_dir/previous-image.txt"
printf '%s\n' "$BACKEND_IMAGE" > "$release_dir/requested-image.txt"
echo "Release backup and logs: $release_dir"

backend_stopped=0
migration_started=0
on_exit() {
  status=$?
  trap - EXIT
  if [[ $status != 0 ]]; then
    if [[ $backend_stopped == 1 && $migration_started == 0 ]]; then
      if docker start "$previous_container" >/dev/null; then
        echo 'Previous backend restarted; migrations were not started.' >&2
      else
        echo 'Could not restart the previous backend; check the server.' >&2
      fi
    fi
    echo "Deployment failed. Private diagnostics: $release_dir. Database was not rolled back." >&2
  fi
  exit "$status"
}
trap on_exit EXIT
backend_stopped=1
docker stop --timeout 60 "$previous_container" >/dev/null

if [[ $deploy_environment == production ]]; then
  echo 'Creating a production database backup before migrations...'
  compose exec -T db sh -ec \
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -w -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
    > "$release_dir/database.dump.partial"
  [[ -s $release_dir/database.dump.partial ]]
  compose exec -T db pg_restore --list < "$release_dir/database.dump.partial" > "$release_dir/database.contents"
  mv "$release_dir/database.dump.partial" "$release_dir/database.dump"
  (cd "$release_dir" && sha256sum database.dump configuration.tar.gz > SHA256SUMS)
fi

migration_started=1
compose up -d --no-deps --force-recreate migrator
migrator=$(compose ps -a -q migrator)
[[ -n $migrator ]]
migration_status=$(docker wait "$migrator")
docker logs "$migrator" > "$release_dir/migration.log" 2>&1
[[ $migration_status == 0 ]] || { echo 'Migration failed; backend remains stopped for investigation.' >&2; exit 1; }
compose up -d --no-deps backend
backend=$(compose ps -q backend)
[[ -n $backend ]]
for attempt in $(seq 1 90); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$backend")
  if [[ $health == healthy ]]; then break; fi
  sleep 2
done
if [[ $health != healthy ]]; then
  docker logs --tail 150 "$backend" > "$release_dir/backend.log" 2>&1
  echo 'New backend did not become healthy. Inspect release logs before rollback.' >&2
  exit 1
fi
if [[ $(docker inspect -f '{{.Config.Image}}' "$backend") != "$BACKEND_IMAGE" ||
      $(docker inspect -f '{{.Image}}' "$backend") != $(docker image inspect -f '{{.Id}}' "$BACKEND_IMAGE") ]]; then
  echo 'Running backend does not match the requested image digest.' >&2
  exit 1
fi
compose exec -T backend curl -fsS http://localhost:4000/api/v1/health >/dev/null

# Persist the proven digest without sourcing .env or changing any other setting.
python3 - "$BACKEND_IMAGE" <<'PY'
import os
from pathlib import Path
import re
import sys
import tempfile
path = Path('.env')
text = path.read_text()
pattern = r'(?m)^(?:export\s+)?BACKEND_IMAGE\s*=.*$'
if len(re.findall(pattern, text)) > 1:
    raise SystemExit('Duplicate BACKEND_IMAGE definitions in .env')
updated, count = re.subn(pattern, 'BACKEND_IMAGE=' + sys.argv[1], text)
if not count:
    updated = text.rstrip('\n') + '\nBACKEND_IMAGE=' + sys.argv[1] + '\n'
metadata = path.stat()
fd, temporary = tempfile.mkstemp(prefix='.env-release-', dir='.')
try:
    with os.fdopen(fd, 'w') as stream:
        stream.write(updated)
        stream.flush()
        os.fsync(stream.fileno())
        os.fchmod(stream.fileno(), metadata.st_mode & 0o777)
        os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY
printf '%s\n' "$BACKEND_IMAGE" > .deployed-image
printf '%s\n' "$release_dir" > .last-release-backup
echo "Deployment healthy: $deploy_environment $BACKEND_IMAGE"
compose ps --all
