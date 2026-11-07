#!/usr/bin/env python3
"""Decrypt a downloaded cloud archive in an isolated local directory and verify its manifest.

Does not connect to Docker, any database, S3 or Production. Does not restore application data.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    parser.add_argument('--identity', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not re.fullmatch(r'[0-9a-f]{64}', args.sha256):
        raise RuntimeError('INVALID_EXPECTED_HASH')
    for path in (args.archive, args.identity):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeError('EXPECTED_REGULAR_INPUT_FILE')
    key_info = args.identity.lstat()
    if key_info.st_uid != os.geteuid() or key_info.st_mode & 0o077:
        raise RuntimeError('PRIVATE_IDENTITY_PERMISSIONS_REQUIRED')
    with args.archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != args.sha256:
            raise RuntimeError('CIPHERTEXT_HASH_MISMATCH')
    if args.destination.exists() or args.destination.is_symlink():
        raise RuntimeError('DESTINATION_MUST_NOT_EXIST')
    parent = args.destination.parent.resolve(strict=True)
    if not parent.is_dir() or parent.stat().st_uid != os.geteuid():
        raise RuntimeError('DESTINATION_PARENT_MUST_BE_OWNED_BY_CURRENT_USER')
    if shutil.disk_usage(parent).free < args.archive.stat().st_size + 1024**3:
        raise RuntimeError('INSUFFICIENT_FREE_SPACE_FOR_DECRYPTION')
    args.destination = parent / args.destination.name
    args.destination.mkdir(mode=0o700)
    artifacts = {'database.dump', 'database-globals.sql', 'redis.rdb', 'minio-data.tar.gz', 'configuration.tar.gz', 'manifest.json'}
    process = subprocess.Popen(['age', '--decrypt', '-i', str(args.identity), str(args.archive)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    seen, checkpoint = set(), None
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
            for item in archive:
                parts = item.name.split('/')
                if (len(parts) != 2 or not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f]{32}', parts[0])
                        or parts[1] not in artifacts or not item.isfile() or item.size > 20 * 1024**3
                        or parts[1] in seen or checkpoint is not None and checkpoint != parts[0]):
                    raise RuntimeError('UNSAFE_OR_UNEXPECTED_ARCHIVE_MEMBER')
                checkpoint = parts[0]
                seen.add(parts[1])
                target = args.destination / parts[1]
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, 'wb') as output, archive.extractfile(item) as source:
                    shutil.copyfileobj(source, output, length=1024**2)
        # Drain to EOF so the age authentication tag, including the end of stream, is checked.
        while process.stdout.read(1024**2):
            pass
        process.stdout.close()
        if process.wait(timeout=30):
            raise RuntimeError('AGE_DECRYPTION_AUTHENTICATION_FAILED')
    except BaseException:
        process.kill()
        process.stdout.close()
        process.wait()
        raise
    if seen != artifacts:
        raise RuntimeError('INCOMPLETE_ARCHIVE')
    manifest_path = args.destination / 'manifest.json'
    if manifest_path.stat().st_size > 1024**2:
        raise RuntimeError('MANIFEST_TOO_LARGE')
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get('format') != 'oxus-local-backup/v1' or manifest.get('environment') != 'production'
            or manifest.get('name') != checkpoint or manifest.get('complete') is not True
            or manifest.get('services_resumed') is not True or set(manifest.get('files', {})) != artifacts - {'manifest.json'}):
        raise RuntimeError('MANIFEST_MISMATCH')
    for name, expected in manifest['files'].items():
        path = args.destination / name
        with path.open('rb') as stream:
            if path.stat().st_size != expected['size_bytes'] or hashlib.file_digest(stream, 'sha256').hexdigest() != expected['sha256']:
                raise RuntimeError('RESTORED_FILE_HASH_MISMATCH')
    print(json.dumps({'status': 'CLOUD_DOWNLOAD_DECRYPTED_AND_FILES_VERIFIED', 'name': checkpoint,
                      'environment': 'production', 'files_verified': len(manifest['files']),
                      'isolated_directory': str(args.destination), 'application_restore_exercised': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'FAILED', 'reason': str(error) if type(error) is RuntimeError else 'VERIFICATION_INCOMPLETE'}))
        raise SystemExit(1)
