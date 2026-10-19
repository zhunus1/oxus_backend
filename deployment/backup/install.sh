#!/usr/bin/env bash
# Install and schedule the local backup. Does not start a backup or stop application services.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $(uname -s) == Linux ]] || { echo 'Run on the selected Linux host as root.' >&2; exit 77; }
[[ $# == 1 && ( $1 == production || $1 == test ) ]] || { echo 'Usage: bash install.sh production|test' >&2; exit 64; }
backup_environment=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v python3 >/dev/null
command -v docker >/dev/null
command -v systemctl >/dev/null
command -v systemd-analyze >/dev/null
python3 "$script_dir/oxus_backup.py" preflight --environment "$backup_environment"

if systemctl is-active --quiet oxus-local-backup@production.service oxus-local-backup@test.service; then
  echo 'Backup is active; installation stopped.' >&2
  exit 75
fi

# Refuse to overwrite a different installed version or an unrelated unit.
for name in oxus-local-backup.service oxus-local-backup.timer; do
  if [[ -e /etc/systemd/system/$name || -L /etc/systemd/system/$name ]]; then
    echo 'A legacy backup unit exists; review the migration separately.' >&2
    exit 78
  fi
done
for name in oxus-local-backup@.service oxus-local-backup@.timer; do
  target=/etc/systemd/system/$name
  if [[ -e $target || -L $target ]]; then
    [[ -f $target && ! -L $target ]] && cmp -s "$script_dir/$name" "$target" || {
      echo 'A different backup unit is installed; review the upgrade separately.' >&2; exit 78;
    }
  fi
done
if [[ -e /usr/local/lib/oxus-backup/oxus_backup.py || -L /usr/local/lib/oxus-backup/oxus_backup.py ]]; then
  [[ -f /usr/local/lib/oxus-backup/oxus_backup.py && ! -L /usr/local/lib/oxus-backup/oxus_backup.py ]] && \
    cmp -s "$script_dir/oxus_backup.py" /usr/local/lib/oxus-backup/oxus_backup.py || {
      echo 'A different backup program is installed; review the upgrade separately.' >&2; exit 78;
    }
fi

python3 - "$backup_environment" <<'PY'
import os
from pathlib import Path
import stat
import sys

environment = sys.argv[1]
if environment not in ('production', 'test'):
    raise SystemExit('STOP: invalid environment')
base = Path('/var/backups/oxus-backend')
store = base / environment
marker = 'oxus-local-backup/v1\n'
for path in (Path('/var/backups'), Path('/usr/local/lib'), Path('/etc/systemd/system')):
    for parent in (path, *path.parents):
        item = parent.lstat()
        if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o022:
            raise SystemExit('STOP: untrusted installation parent')
if not base.exists() and not base.is_symlink():
    base.mkdir(mode=0o700)
item = base.lstat()
if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o077:
    raise SystemExit('STOP: unsafe backup parent')
if (base / '.format').exists():
    raise SystemExit('STOP: legacy backup layout requires separate review')
if store.exists() or store.is_symlink():
    item = store.lstat()
    if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o077:
        raise SystemExit('STOP: unsafe backup directory')
    if not (store / '.format').is_file() or (store / '.format').is_symlink() or (store / '.format').read_text() != marker:
        raise SystemExit('STOP: existing backup directory is not owned by this tool')
else:
    store.mkdir(mode=0o700)
    fd = os.open(store / '.format', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(marker)
for name in ('snapshots', '.partial', '.trash', 'operations'):
    path = store / name
    if not path.exists():
        path.mkdir(mode=0o700)
    item = path.lstat()
    if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o077:
        raise SystemExit('STOP: unsafe backup subdirectory')
lock = Path('/opt/oxus_backend/deployment/.deploy.lock')
if not lock.exists() and not lock.is_symlink():
    os.close(os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
item = lock.lstat()
if not stat.S_ISREG(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o022 or item.st_nlink != 1:
    raise SystemExit('STOP: unsafe shared deployment lock')
target = Path('/usr/local/lib/oxus-backup')
if not target.exists():
    target.mkdir(mode=0o700)
item = target.lstat()
if not stat.S_ISDIR(item.st_mode) or item.st_uid != 0 or item.st_mode & 0o077:
    raise SystemExit('STOP: unsafe program directory')
PY

install -o root -g root -m 0700 "$script_dir/oxus_backup.py" /usr/local/lib/oxus-backup/oxus_backup.py
install -o root -g root -m 0644 "$script_dir/oxus-local-backup@.service" /etc/systemd/system/oxus-local-backup@.service
install -o root -g root -m 0644 "$script_dir/oxus-local-backup@.timer" /etc/systemd/system/oxus-local-backup@.timer
systemd-analyze verify \
  "/etc/systemd/system/oxus-local-backup@.service:oxus-local-backup@${backup_environment}.service" \
  "/etc/systemd/system/oxus-local-backup@.timer:oxus-local-backup@${backup_environment}.timer"
systemctl daemon-reload
systemctl enable --now "oxus-local-backup@${backup_environment}.timer"
systemctl is-enabled --quiet "oxus-local-backup@${backup_environment}.timer"
systemctl is-active --quiet "oxus-local-backup@${backup_environment}.timer"
echo 'Local backup timer installed. No backup has been started by this installer.'
systemctl list-timers "oxus-local-backup@${backup_environment}.timer" --all --no-pager
python3 /usr/local/lib/oxus-backup/oxus_backup.py status --environment "$backup_environment"
