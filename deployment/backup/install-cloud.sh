#!/usr/bin/env bash
# Production only. Install without starting a backup, uploading data, or enabling a timer.
set -Eeuo pipefail
umask 077
[[ $EUID == 0 && $(uname -s) == Linux ]] || { echo 'Run on Production Linux as root.' >&2; exit 77; }
[[ $# == 1 ]] || { echo 'Usage: bash install-cloud.sh /root/production.recipient.txt' >&2; exit 64; }
cloud_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cloud_recipient_path=$1
command -v age >/dev/null
/usr/bin/python3 -c 'import boto3; import botocore' >/dev/null
command -v systemd-analyze >/dev/null
cmp -s "$cloud_script_dir/oxus_backup.py" /usr/local/lib/oxus-backup/oxus_backup.py || {
  echo 'Installed local backup differs from the reviewed baseline; stop and review compatibility.' >&2; exit 78;
}
if systemctl is-active --quiet oxus-cloud-backup.service; then
  echo 'Cloud upload is running; installation stopped.' >&2; exit 75
fi
for cloud_name in oxus_cloud_backup.py; do
  cloud_target=/usr/local/lib/oxus-backup/$cloud_name
  if [[ -e $cloud_target || -L $cloud_target ]]; then
    [[ -f $cloud_target && ! -L $cloud_target ]] && cmp -s "$cloud_script_dir/$cloud_name" "$cloud_target" || {
      echo 'A different cloud program is installed; review the upgrade separately.' >&2; exit 78;
    }
  fi
done
for cloud_name in oxus-cloud-backup.service oxus-cloud-backup.timer; do
  cloud_target=/etc/systemd/system/$cloud_name
  if [[ -e $cloud_target || -L $cloud_target ]]; then
    [[ -f $cloud_target && ! -L $cloud_target ]] && cmp -s "$cloud_script_dir/$cloud_name" "$cloud_target" || {
      echo 'A different cloud unit is installed; review the upgrade separately.' >&2; exit 78;
    }
  fi
done

/usr/bin/python3 - "$cloud_script_dir" "$cloud_recipient_path" <<'PY'
import importlib.util
import os
from pathlib import Path
import re
import stat
import sys

directory, recipient_path = Path(sys.argv[1]), Path(sys.argv[2])
sys.path.insert(0, str(directory))
import oxus_cloud_backup as cloud
local = cloud.local
local.trusted_directory(directory)
local.trusted_directory(Path('/usr/local/lib/oxus-backup'))
local.private(Path('/usr/local/lib/oxus-backup'), directory=True)
# Test has neither this Production store nor STAGING=false; fail before creating files.
cloud.production_guard()
local.private(recipient_path)
if recipient_path.stat().st_size > 4096:
    raise SystemExit('STOP: invalid recipient file')
recipient = recipient_path.read_text().strip()
if not cloud.RECIPIENT.fullmatch(recipient):
    raise SystemExit('STOP: expected exactly one age public X25519 recipient')
local.trusted_directory(cloud.CONFIG.parent)
local.private(cloud.CONFIG.parent, directory=True)
local.read_json(cloud.CREDENTIALS)
configuration = dict(format=cloud.FORMAT, environment='production', endpoint=cloud.ENDPOINT,
                     bucket=cloud.BUCKET, region=cloud.REGION, recipient=recipient,
                     lock_days=7, lock_mode='COMPLIANCE')
if cloud.CONFIG.exists() or cloud.CONFIG.is_symlink():
    if local.read_json(cloud.CONFIG) != configuration:
        raise SystemExit('STOP: existing cloud target or recipient differs; no overwrite')
else:
    local.write_json(cloud.CONFIG, configuration)
cloud.target_config()
local.trusted_directory(cloud.STATE.parent.parent)
for path in (cloud.STATE.parent, cloud.STATE):
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700)
    local.private(path, directory=True)
marker = cloud.STATE / 'format.json'
expected_marker = {'format': cloud.FORMAT, 'environment': 'production'}
if marker.exists() or marker.is_symlink():
    if local.read_json(marker) != expected_marker:
        raise SystemExit('STOP: unrecognized cloud state directory')
else:
    if any(cloud.STATE.iterdir()):
        raise SystemExit('STOP: existing unmarked directory is not empty')
    local.write_json(marker, expected_marker)
spool = cloud.STATE / 'spool'
if not spool.exists() and not spool.is_symlink():
    spool.mkdir(mode=0o700)
local.private(spool, directory=True)
lock = cloud.STATE / 'job.lock'
if not lock.exists() and not lock.is_symlink():
    os.close(os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600))
local.private(lock)
cloud.state_layout()
PY

install -o root -g root -m 0700 "$cloud_script_dir/oxus_cloud_backup.py" /usr/local/lib/oxus-backup/oxus_cloud_backup.py
install -o root -g root -m 0644 "$cloud_script_dir/oxus-cloud-backup.service" /etc/systemd/system/oxus-cloud-backup.service
install -o root -g root -m 0644 "$cloud_script_dir/oxus-cloud-backup.timer" /etc/systemd/system/oxus-cloud-backup.timer
systemd-analyze verify /etc/systemd/system/oxus-cloud-backup.service /etc/systemd/system/oxus-cloud-backup.timer
systemctl daemon-reload
/usr/bin/python3 /usr/local/lib/oxus-backup/oxus_cloud_backup.py preflight
echo 'Cloud program installed. No upload started and timer was not enabled by this installer.'
echo 'Next: run probe, run, verify, then enable oxus-cloud-backup.timer.'
