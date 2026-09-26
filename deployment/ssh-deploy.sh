#!/usr/bin/env bash
# Runner-side SSH transport. Application secrets remain on the server.
set -Eeuo pipefail

[[ ${DEPLOY_ENVIRONMENT:-} =~ ^(test|production)$ ]] || { echo 'Invalid deployment environment.' >&2; exit 64; }
[[ ${DEPLOY_HOST:-} =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || { echo 'Invalid or missing deployment host.' >&2; exit 64; }
[[ ${DEPLOY_IMAGE:-} =~ ^ghcr\.io/zhunus1/oxus_backend@sha256:[a-f0-9]{64}$ ]] || { echo 'An immutable image digest is required.' >&2; exit 64; }
[[ -n ${DEPLOY_SSH_PRIVATE_KEY:-} && -n ${DEPLOY_SSH_KNOWN_HOSTS:-} ]] || { echo 'Deployment SSH secrets are missing.' >&2; exit 78; }

umask 077
ssh_dir=$(mktemp -d "${RUNNER_TEMP:-/tmp}/oxus-deploy-ssh-XXXXXX")
trap 'rm -rf -- "$ssh_dir"' EXIT
printf '%s\n' "$DEPLOY_SSH_PRIVATE_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_SSH_KNOWN_HOSTS" > "$ssh_dir/known_hosts"

ssh -i "$ssh_dir/key" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$ssh_dir/known_hosts" \
  -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
  "oxusdeploy@$DEPLOY_HOST" \
  "sudo -n /opt/oxus_backend/deployment/deploy.sh $DEPLOY_ENVIRONMENT $DEPLOY_IMAGE" | tee "$ssh_dir/result"
# An older server script ignores arguments; never record its success as a tested digest.
grep -Fx -- "Deployment healthy: $DEPLOY_ENVIRONMENT $DEPLOY_IMAGE" "$ssh_dir/result" >/dev/null
