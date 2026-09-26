#!/usr/bin/env bash
# One-time root installation on an existing Test/Production server.
# Optional argument: an Ed25519 public key to authorize for oxusdeploy.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $# -le 1 ]]
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
target=/opt/oxus_backend/deployment
[[ -f $target/.env && -f $target/compose.yaml && -s $target/jitsi-private-key.pk ]]
bash -n "$source_dir/deploy.sh"
command -v flock >/dev/null
command -v python3 >/dev/null
command -v visudo >/dev/null

if [[ $# == 1 ]]; then
  [[ $(wc -l < "$1") == 1 ]]
  grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]+=*( .*)?$' "$1"
  ssh-keygen -lf "$1" >/dev/null
  public_key=$(cat "$1")
fi
if ! id oxusdeploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash oxusdeploy
fi

mkdir -p /var/backups
backup_dir=$(mktemp -d "/var/backups/oxus-ci-setup-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
if [[ -f $target/deploy.sh ]]; then cp -p "$target/deploy.sh" "$backup_dir/deploy.sh"; fi
if [[ -f /etc/sudoers.d/oxus-backend-deploy ]]; then
  cp -p /etc/sudoers.d/oxus-backend-deploy "$backup_dir/sudoers";
fi
printf '%s\n' 'oxusdeploy ALL=(root) NOPASSWD: /opt/oxus_backend/deployment/deploy.sh' > "$backup_dir/sudoers.new"
visudo -cf "$backup_dir/sudoers.new"
# The sudo executable and the path containing it must not be deploy-user writable.
chown root:root /opt/oxus_backend "$target"
chmod go-w /opt/oxus_backend "$target"
install -o root -g root -m 700 "$source_dir/deploy.sh" "$target/deploy.sh"
install -o root -g root -m 440 "$backup_dir/sudoers.new" /etc/sudoers.d/oxus-backend-deploy
visudo -c

if [[ $# == 1 ]]; then
  deploy_home=$(getent passwd oxusdeploy | cut -d: -f6)
  install -d -o oxusdeploy -g oxusdeploy -m 700 "$deploy_home/.ssh"
  authorized_keys="$deploy_home/.ssh/authorized_keys"
  touch "$authorized_keys"
  if ! grep -Fq -- "$public_key" "$authorized_keys"; then
    printf '\nrestrict %s\n' "$public_key" >> "$authorized_keys"
  fi
  chown oxusdeploy:oxusdeploy "$authorized_keys"
  chmod 600 "$authorized_keys"
fi
echo "CI installer ready. Previous script: $backup_dir"
echo 'No deployment was started. Environment, Compose, Jitsi key and Nginx were preserved.'
