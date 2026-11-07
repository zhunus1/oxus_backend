#!/usr/bin/env python3
"""Encrypted Production checkpoints in PS Cloud; never stops application services."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, ExitStack
from datetime import datetime, timedelta, timezone
import base64
import fcntl
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import uuid

import oxus_backup as local

FORMAT = 'oxus-cloud-backup/v1'
CONFIG = Path('/etc/oxus-backup/cloud.json')
CREDENTIALS = Path('/etc/oxus-backup/pscloud.json')
STATE = Path('/var/backups/oxus-cloud/production')
SOURCE = local.STORE / 'production'
ENDPOINT = 'https://object.pscloud.io'
BUCKET = 'oxus-prod-backups-locked'
REGION = 'kz-ala-1'
PREFIX = 'oxus-backup/v1/production/'
PART_SIZE = 16 * 1024**2
MAX_CIPHER = 20_000_000_000
MAX_VERSIONS = 2048
RECIPIENT = re.compile(r'age1[a-z0-9]{58}')
HEX = re.compile(r'[0-9a-f]{64}')
POINT_KEY = re.compile(re.escape(PREFIX) + r'(\d{8}T\d{6}Z-[0-9a-f]{32})/(archive\.tar\.age|complete\.json)')
PROBE_KEY = re.compile(re.escape(PREFIX) + r'checks/[0-9a-f]{32}\.age')


class CloudError(RuntimeError):
    """Fixed diagnostics only; provider error messages and secrets never reach logs."""


def now():
    return datetime.now(timezone.utc)


def timestamp(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise CloudError('TIMEZONE_REQUIRED')
    return parsed.astimezone(timezone.utc)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def error_code(error):
    value = getattr(error, 'response', {}).get('Error', {}).get('Code', '')
    public_codes = {'404', 'NotFound', 'AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch',
                    'NoSuchKey', 'NoSuchBucket', 'NoSuchVersion', 'NoSuchUpload', 'InvalidBucketState',
                    'InvalidRequest', 'RequestTimeout', 'SlowDown', 'ServiceUnavailable', 'InternalError',
                    'InvalidArgument', 'InvalidDigest', 'BadDigest', 'RequestTimeTooSkewed'}
    return value if isinstance(value, str) and value in public_codes else 'REMOTE_OPERATION_FAILED'


def target_config():
    local.trusted_directory(CONFIG.parent)
    config, credentials = local.read_json(CONFIG), local.read_json(CREDENTIALS)
    if (set(config) != {'format', 'environment', 'endpoint', 'bucket', 'region', 'lock_days', 'lock_mode', 'recipient'}
            or config.get('format') != FORMAT or config.get('environment') != 'production'
            or config.get('endpoint') != ENDPOINT or config.get('bucket') != BUCKET
            or config.get('region') != REGION or config.get('lock_days') != 7
            or config.get('lock_mode') != 'COMPLIANCE'
            or not RECIPIENT.fullmatch(config.get('recipient', ''))):
        raise CloudError('CLOUD_CONFIGURATION_MISMATCH')
    if (credentials.get('environment') != 'production' or credentials.get('endpoint') != ENDPOINT
            or credentials.get('region') != REGION
            or credentials.get('bucket') not in ('oxus-prod-backups', BUCKET)):
        raise CloudError('CREDENTIAL_TARGET_MISMATCH')
    for name in ('access_key_id', 'secret_access_key'):
        value = credentials.get(name)
        if not isinstance(value, str) or not 1 <= len(value) <= 4096 or any(not 33 <= ord(c) <= 126 for c in value):
            raise CloudError('INVALID_CREDENTIAL_FORMAT')
    return config, credentials


def production_guard(check_containers=True):
    if sys.platform != 'linux' or os.geteuid() != 0 or sys.version_info < (3, 11):
        raise CloudError('PRODUCTION_LINUX_ROOT_REQUIRED')
    local.store_layout(SOURCE)
    latest = local.read_json(SOURCE / 'last-success.json')
    if latest.get('environment') != 'production' or not local.RUN_NAME.fullmatch(latest.get('name', '')):
        raise CloudError('PRODUCTION_SOURCE_NOT_CONFIRMED')
    if not check_containers:
        return latest
    apps, databases = local.containers(service='backend'), local.containers(service='db')
    if len(apps) != 1 or len(databases) != 1:
        raise CloudError('EXPECTED_PRODUCTION_CONTAINERS')
    local.check_target(local.environment(apps[0]), local.environment(databases[0]), 'production')
    return latest


def state_layout():
    local.trusted_directory(STATE.parent)
    local.private(STATE, directory=True)
    if local.read_json(STATE / 'format.json') != {'format': FORMAT, 'environment': 'production'}:
        raise CloudError('UNRECOGNIZED_CLOUD_STATE')
    local.private(STATE / 'spool', directory=True)


@contextmanager
def job_lock():
    path = STATE / 'job.lock'
    local.private(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise CloudError('CLOUD_JOB_ALREADY_RUNNING') from error
        yield
    finally:
        os.close(fd)


def client(credentials):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as error:
        raise CloudError('PYTHON3_BOTO3_NOT_INSTALLED') from error
    logging.getLogger('boto3').setLevel(logging.CRITICAL)
    logging.getLogger('botocore').setLevel(logging.CRITICAL)
    options = dict(signature_version='s3v4', connect_timeout=10, read_timeout=90,
                   retries={'total_max_attempts': 1}, proxies={},
                   s3={'addressing_style': 'path', 'payload_signing_enabled': True})
    # Recent SDKs otherwise add optional trailing checksums some S3 providers reject.
    if 'request_checksum_calculation' in Config.OPTION_DEFAULTS:
        options.update(request_checksum_calculation='when_required', response_checksum_validation='when_required')
    return boto3.session.Session().client('s3', endpoint_url=ENDPOINT, region_name=REGION,
        aws_access_key_id=credentials['access_key_id'], aws_secret_access_key=credentials['secret_access_key'],
        config=Config(**options))


def protections(s3):
    if s3.get_bucket_versioning(Bucket=BUCKET).get('Status') != 'Enabled':
        raise CloudError('BUCKET_VERSIONING_NOT_ENABLED')
    lock = s3.get_object_lock_configuration(Bucket=BUCKET).get('ObjectLockConfiguration', {})
    if lock.get('ObjectLockEnabled') != 'Enabled':
        raise CloudError('BUCKET_OBJECT_LOCK_NOT_ENABLED')
    if s3.get_bucket_location(Bucket=BUCKET).get('LocationConstraint') != 'kz':
        raise CloudError('BUCKET_LOCATION_MISMATCH')


def keys(name):
    if not local.RUN_NAME.fullmatch(name):
        raise CloudError('INVALID_CHECKPOINT_NAME')
    return PREFIX + name + '/archive.tar.age', PREFIX + name + '/complete.json'


def validate_point(point):
    name = point.get('name', '')
    if not local.RUN_NAME.fullmatch(name) or point.get('environment') != 'production':
        raise CloudError('INVALID_POINT_IDENTITY')
    started = datetime.strptime(name[:16], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    expected_date = started.astimezone(local.ALMATY).date().isoformat()
    completed = timestamp(point['completed_at_utc'])
    if point.get('date_almaty') != expected_date or not started <= completed <= now() + timedelta(minutes=5):
        raise CloudError('INVALID_POINT_TIME')


def selected_sources():
    manifests = []
    for path in (SOURCE / 'snapshots').iterdir():
        local.private(path, directory=True)
        manifest = local.read_json(path / 'manifest.json')
        validate_point(manifest)
        if manifest.get('format') != local.FORMAT or manifest.get('complete') is not True or manifest.get('services_resumed') is not True:
            raise CloudError('INCOMPLETE_LOCAL_POINT')
        manifests.append(manifest)
    if not manifests:
        raise CloudError('NO_LOCAL_POINT')
    # Backfill every still-retained local daily point and the latest successful Sunday.
    ordered = sorted(manifests, key=lambda value: value['completed_at_utc'], reverse=True)
    newest = ordered[0]
    if now() - timestamp(newest['completed_at_utc']) > timedelta(hours=30):
        raise CloudError('LATEST_LOCAL_BACKUP_OLDER_THAN_30_HOURS')
    keep = local.retention_keep(ordered)
    return [item for item in ordered if item['name'] in keep]


@contextmanager
def pinned_source(name):
    """Open the immutable artifacts under the deploy lock, then release it before encryption/network IO."""
    with ExitStack() as streams:
        with local.deploy_lock(local.PROJECT):
            if (SOURCE / 'active.json').exists():
                raise CloudError('LOCAL_BACKUP_RECOVERY_PENDING')
            path = SOURCE / 'snapshots' / name
            local.private(path, directory=True)
            manifest = local.read_json(path / 'manifest.json')
            validate_point(manifest)
            if (manifest.get('format') != local.FORMAT or manifest.get('complete') is not True
                    or manifest.get('name') != name or manifest.get('services_resumed') is not True
                    or set(manifest.get('files', {})) != local.ARTIFACTS
                    or {entry.name for entry in path.iterdir()} != local.ARTIFACTS | {'manifest.json'}):
                raise CloudError('INVALID_SOURCE_MANIFEST')
            handles = {}
            for filename in sorted(local.ARTIFACTS):
                item = path / filename
                info = local.private(item)
                fd = os.open(item, os.O_RDONLY | os.O_NOFOLLOW)
                handle = streams.enter_context(os.fdopen(fd, 'rb'))
                opened = os.fstat(fd)
                expected = manifest['files'][filename]
                if (opened.st_ino != info.st_ino or opened.st_size != expected.get('size_bytes')
                        or opened.st_size <= 0 or not HEX.fullmatch(expected.get('sha256', ''))):
                    raise CloudError('SOURCE_FILE_CHANGED')
                handles[filename] = handle
        # Open descriptors survive local retention unlinking a source checkpoint.
        yield manifest, handles


class HashReader:
    def __init__(self, source):
        self.source, self.hasher = source, hashlib.sha256()

    def read(self, size=-1):
        value = self.source.read(size)
        self.hasher.update(value)
        return value


def encrypt_point(name, config, directory):
    cipher = directory / 'archive.tar.age'
    temporary = directory / 'archive.partial'
    if temporary.exists():
        local.private(temporary)
        temporary.unlink()
    age = shutil.which('age')
    if not age:
        raise CloudError('AGE_NOT_INSTALLED')
    with pinned_source(name) as (manifest, handles), local.new_file(temporary) as output:
        if shutil.disk_usage(STATE).free < sum(item['size_bytes'] for item in manifest['files'].values()) + 1024**3:
            raise CloudError('INSUFFICIENT_CLOUD_SPOOL_SPACE')
        process = subprocess.Popen([age, '--encrypt', '-r', config['recipient']], stdin=subprocess.PIPE,
                                   stdout=output, stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=process.stdin, mode='w|', format=tarfile.USTAR_FORMAT) as archive:
                for filename, source in handles.items():
                    expected = manifest['files'][filename]
                    item = tarfile.TarInfo(name + '/' + filename)
                    item.size, item.mode = expected['size_bytes'], 0o600
                    reader = HashReader(source)
                    archive.addfile(item, reader)
                    if reader.hasher.hexdigest() != expected['sha256'] or source.read(1):
                        raise CloudError('SOURCE_HASH_MISMATCH')
                data = encoded(manifest)
                item = tarfile.TarInfo(name + '/manifest.json')
                item.size, item.mode = len(data), 0o600
                archive.addfile(item, io.BytesIO(data))
            process.stdin.close()
            if process.wait(timeout=60):
                raise CloudError('AGE_ENCRYPTION_FAILED')
            output.flush()
            os.fsync(output.fileno())
        except BaseException:
            process.kill()
            try:
                process.stdin.close()
            except OSError:
                pass
            process.wait()
            raise
    if not 1 <= local.private(temporary).st_size <= MAX_CIPHER:
        raise CloudError('ENCRYPTED_ARCHIVE_SIZE_LIMIT')
    os.replace(temporary, cipher)
    local.sync_directory(directory)
    return manifest, cipher


def head(s3, key):
    try:
        return s3.head_object(Bucket=BUCKET, Key=key)
    except Exception as error:
        if error_code(error) in ('404', 'NoSuchKey', 'NotFound'):
            return None
        raise


def version_id(result):
    value = result.get('VersionId')
    if not isinstance(value, str) or not value or value == 'null' or len(value) > 1024:
        raise CloudError('VERSION_ID_NOT_RETURNED')
    return value


def retain(s3, key, version, minimum):
    retention = s3.get_object_retention(Bucket=BUCKET, Key=key, VersionId=version).get('Retention', {})
    until = retention.get('RetainUntilDate')
    if retention.get('Mode') != 'COMPLIANCE' or not isinstance(until, datetime) or until.tzinfo is None or until < minimum - timedelta(seconds=1):
        raise CloudError('OBJECT_COMPLIANCE_RETENTION_NOT_VERIFIED')
    return until


def download_hash(s3, key, version, expected_size):
    response = s3.get_object(Bucket=BUCKET, Key=key, VersionId=version)
    total, hasher = 0, hashlib.sha256()
    with response['Body'] as body:
        while chunk := body.read(1024**2):
            total += len(chunk)
            if total > expected_size:
                raise CloudError('DOWNLOADED_SIZE_EXCEEDED')
            hasher.update(chunk)
    if total != expected_size:
        raise CloudError('DOWNLOADED_SIZE_MISMATCH')
    return hasher.hexdigest()


def upload_file(s3, path, key, sha, until, directory):
    existing = head(s3, key)
    if existing is not None:
        if existing.get('Metadata', {}).get('sha256') != sha or existing.get('ContentLength') != path.stat().st_size:
            raise CloudError('EXISTING_REMOTE_OBJECT_MISMATCH')
        return version_id(existing)
    metadata = {'sha256': sha, 'oxus-format': FORMAT}
    arguments = dict(Bucket=BUCKET, Key=key, Metadata=metadata, ContentType='application/octet-stream',
                     ObjectLockMode='COMPLIANCE', ObjectLockRetainUntilDate=until)
    if path.stat().st_size < PART_SIZE:
        with path.open('rb') as stream:
            md5 = hashlib.file_digest(stream, lambda: hashlib.md5(usedforsecurity=False)).digest()
            stream.seek(0)
            result = s3.put_object(**arguments, Body=stream, ContentMD5=base64.b64encode(md5).decode())
    else:
        journal = directory / 'multipart.json'
        if journal.exists():
            pending = local.read_json(journal)
            if pending.get('key') != key or not isinstance(pending.get('upload_id'), str):
                raise CloudError('INVALID_MULTIPART_JOURNAL')
            try:
                s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=pending['upload_id'])
            except Exception as error:
                if error_code(error) != 'NoSuchUpload':
                    raise
            journal.unlink()
        upload = s3.create_multipart_upload(**arguments)
        upload_id = upload.get('UploadId')
        if not isinstance(upload_id, str) or not 1 <= len(upload_id) <= 2048:
            raise CloudError('MULTIPART_ID_NOT_RETURNED')
        local.write_json(journal, {'key': key, 'upload_id': upload_id})
        parts = []
        with path.open('rb') as stream:
            while chunk := stream.read(PART_SIZE):
                number = len(parts) + 1
                result = s3.upload_part(Bucket=BUCKET, Key=key, UploadId=upload_id, PartNumber=number,
                    Body=chunk, ContentMD5=base64.b64encode(hashlib.md5(chunk, usedforsecurity=False).digest()).decode())
                parts.append({'PartNumber': number, 'ETag': result['ETag']})
        result = s3.complete_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id, MultipartUpload={'Parts': parts})
        journal.unlink()
    if result.get('VersionId') and result.get('VersionId') != 'null':
        return version_id(result)
    # Some compatible servers omit VersionId in the upload response. Resolve it
    # without issuing another PUT and verify that it is still this ciphertext.
    stored = head(s3, key)
    if stored is None or stored.get('ContentLength') != path.stat().st_size or stored.get('Metadata', {}).get('sha256') != sha:
        raise CloudError('UPLOADED_VERSION_NOT_RESOLVED')
    return version_id(stored)


def remote_receipt(s3, key, version=None):
    arguments = dict(Bucket=BUCKET, Key=key)
    if version:
        arguments['VersionId'] = version
    response = s3.get_object(**arguments)
    with response['Body'] as body:
        raw = body.read(65537)
    if len(raw) > 65536:
        raise CloudError('REMOTE_RECEIPT_TOO_LARGE')
    point = json.loads(raw)
    validate_point(point)
    archive_key, commit_key = keys(point['name'])
    if (key != commit_key or point.get('format') != FORMAT or point.get('complete') is not True
            or point.get('archive_key') != archive_key or not HEX.fullmatch(point.get('sha256', ''))
            or not isinstance(point.get('size_bytes'), int) or not 1 <= point['size_bytes'] <= MAX_CIPHER
            or not RECIPIENT.fullmatch(point.get('recipient', '')) or not isinstance(point.get('archive_version'), str)
            or not point['archive_version'] or point['archive_version'] == 'null'):
        raise CloudError('INVALID_REMOTE_RECEIPT')
    timestamp(point['retain_until_utc'])
    return point


def publish(s3, manifest, config):
    name = manifest['name']
    archive_key, receipt_key = keys(name)
    existing_commit = head(s3, receipt_key)
    if existing_commit:
        point = remote_receipt(s3, receipt_key, version_id(existing_commit))
        if point['recipient'] != config['recipient']:
            raise CloudError('RECIPIENT_CHANGED_REVIEW_REQUIRED')
        stored = s3.head_object(Bucket=BUCKET, Key=archive_key, VersionId=point['archive_version'])
        if stored.get('ContentLength') != point['size_bytes'] or stored.get('Metadata', {}).get('sha256') != point['sha256']:
            raise CloudError('COMMITTED_ARCHIVE_MISMATCH')
        directory = STATE / 'spool' / name
        if directory.exists():
            clear_spool(directory)
        return point, False
    directory = STATE / 'spool' / name
    if not directory.exists():
        directory.mkdir(mode=0o700)
    local.private(directory, directory=True)
    preparation = directory / 'prepared.json'
    if preparation.exists():
        point = local.read_json(preparation)
        validate_point(point)
        cipher = directory / 'archive.tar.age'
        if point.get('recipient') != config['recipient'] or local.private(cipher).st_size != point['size_bytes'] or local.digest(cipher) != point['sha256']:
            raise CloudError('PREPARED_ARCHIVE_CHANGED')
    else:
        manifest, cipher = encrypt_point(name, config, directory)
        point = {key: manifest[key] for key in ('name', 'environment', 'date_almaty', 'completed_at_utc')}
        point.update(format=FORMAT, complete=True, archive_key=archive_key, recipient=config['recipient'],
                     sha256=local.digest(cipher), size_bytes=cipher.stat().st_size,
                     retain_until_utc=(now() + timedelta(days=7)).isoformat())
        local.write_json(preparation, point)
    # A failed attempt may be retried after the original planned retention has expired.
    until = max(timestamp(point['retain_until_utc']), now() + timedelta(days=7))
    point['retain_until_utc'] = until.isoformat()
    local.write_json(preparation, point)
    version = upload_file(s3, cipher, archive_key, point['sha256'], until, directory)
    retention = s3.get_object_retention(Bucket=BUCKET, Key=archive_key, VersionId=version).get('Retention', {})
    current_until = retention.get('RetainUntilDate')
    if retention.get('Mode') == 'COMPLIANCE' and isinstance(current_until, datetime) and current_until < until:
        s3.put_object_retention(Bucket=BUCKET, Key=archive_key, VersionId=version,
                               Retention={'Mode': 'COMPLIANCE', 'RetainUntilDate': until})
    retain(s3, archive_key, version, until)
    if download_hash(s3, archive_key, version, point['size_bytes']) != point['sha256']:
        raise CloudError('CLOUD_DOWNLOAD_HASH_MISMATCH')
    point.update(archive_version=version, uploaded_at_utc=now().isoformat(), restore_exercised=False)
    payload = encoded(point)
    response = s3.put_object(Bucket=BUCKET, Key=receipt_key, Body=payload, ContentType='application/json',
        ContentMD5=base64.b64encode(hashlib.md5(payload, usedforsecurity=False).digest()).decode(),
        ObjectLockMode='COMPLIANCE', ObjectLockRetainUntilDate=until,
        Metadata={'sha256': hashlib.sha256(payload).hexdigest(), 'oxus-format': FORMAT})
    receipt_version = version_id(response if response.get('VersionId') not in (None, 'null') else (head(s3, receipt_key) or {}))
    retain(s3, receipt_key, receipt_version, until)
    if remote_receipt(s3, receipt_key, receipt_version) != point:
        raise CloudError('COMMIT_READBACK_MISMATCH')
    success = STATE / 'last-success.json'
    previous = local.read_json(success) if success.exists() else None
    if previous is None or timestamp(previous['completed_at_utc']) < timestamp(point['completed_at_utc']):
        local.write_json(success, point)
    clear_spool(directory)
    return point, True


def clear_spool(directory):
    local.private(directory, directory=True)
    if not local.RUN_NAME.fullmatch(directory.name):
        raise CloudError('UNRECOGNIZED_SPOOL_POINT')
    entries = list(directory.iterdir())
    if any(item.name not in ('prepared.json', 'archive.tar.age', 'archive.partial', 'multipart.json') for item in entries):
        raise CloudError('UNEXPECTED_SPOOL_FILE')
    for item in entries:
        local.private(item)
    for item in entries:
        item.unlink()
    directory.rmdir()


def versions(s3):
    objects = []
    for page in s3.get_paginator('list_object_versions').paginate(Bucket=BUCKET, Prefix=PREFIX):
        for entry in page.get('Versions', []) + page.get('DeleteMarkers', []):
            key = entry['Key']
            if not POINT_KEY.fullmatch(key) and not PROBE_KEY.fullmatch(key):
                raise CloudError('UNRECOGNIZED_MANAGED_REMOTE_KEY')
            version_id(entry)
            objects.append({**entry, 'delete_marker': entry in page.get('DeleteMarkers', [])})
            if len(objects) > MAX_VERSIONS:
                raise CloudError('REMOTE_VERSION_LIMIT_REVIEW_REQUIRED')
    return objects


def clean_multipart(s3):
    for page in s3.get_paginator('list_multipart_uploads').paginate(Bucket=BUCKET, Prefix=PREFIX):
        for upload in page.get('Uploads', []):
            if not POINT_KEY.fullmatch(upload['Key']):
                raise CloudError('UNRECOGNIZED_MULTIPART_KEY')
            if now() - upload['Initiated'] > timedelta(hours=1):
                s3.abort_multipart_upload(Bucket=BUCKET, Key=upload['Key'], UploadId=upload['UploadId'])


def prune(s3, protected_names):
    objects = versions(s3)
    receipts, protected_versions = [], {}
    for entry in objects:
        if entry.get('IsLatest') and not entry['delete_marker'] and entry['Key'].endswith('/complete.json'):
            point = remote_receipt(s3, entry['Key'], entry['VersionId'])
            stored = s3.head_object(Bucket=BUCKET, Key=point['archive_key'], VersionId=point['archive_version'])
            if stored.get('ContentLength') != point['size_bytes'] or stored.get('Metadata', {}).get('sha256') != point['sha256']:
                raise CloudError('RETENTION_ARCHIVE_REFERENCE_INVALID')
            receipts.append(point)
            protected_versions[point['name']] = {(entry['Key'], entry['VersionId']),
                                                  (point['archive_key'], point['archive_version'])}
    if not receipts:
        raise CloudError('NO_REMOTE_COMPLETED_POINT_NO_PRUNE')
    keep = local.retention_keep(receipts)
    groups = {}
    for entry in objects:
        match = POINT_KEY.fullmatch(entry['Key'])
        group = match.group(1) if match else entry['Key']
        groups.setdefault(group, []).append(entry)
    plan, locked = [], 0
    for name, entries in groups.items():
        if name in keep:
            # Even a retained checkpoint can have obsolete noncurrent versions.
            entries = [entry for entry in entries if (entry['Key'], entry['VersionId']) not in protected_versions[name]]
        elif name in protected_names:
            continue
        if not entries:
            continue
        blocked = False
        for entry in entries:
            if entry['delete_marker']:
                continue
            retention = s3.get_object_retention(Bucket=BUCKET, Key=entry['Key'], VersionId=entry['VersionId']).get('Retention', {})
            until = retention.get('RetainUntilDate')
            if retention.get('Mode') != 'COMPLIANCE' or not isinstance(until, datetime) or until.tzinfo is None:
                raise CloudError('RETENTION_STATE_UNKNOWN_NO_DELETE')
            if until > now() - timedelta(minutes=2):
                blocked = True
        if blocked:
            locked += 1
        else:
            # Remove obsolete completion records before their archives. An interruption
            # then leaves collectible orphan data rather than a broken completion record.
            plan.extend(sorted(entries, key=lambda entry: not entry['Key'].endswith('/complete.json')))
    for entry in plan:
        s3.delete_object(Bucket=BUCKET, Key=entry['Key'], VersionId=entry['VersionId'])
    removed = {(entry['Key'], entry['VersionId']) for entry in plan}
    if removed and removed & {(entry['Key'], entry['VersionId']) for entry in versions(s3)}:
        raise CloudError('VERSION_DELETION_NOT_VERIFIED')
    return {'retained_points': len(keep), 'expired_versions_deleted': len(plan), 'retired_groups_still_locked': locked}


def status():
    latest = local.read_json(STATE / 'last-success.json') if (STATE / 'last-success.json').exists() else None
    age_hours = round((now() - timestamp(latest['completed_at_utc'])).total_seconds() / 3600, 2) if latest else None
    return {'environment': 'production', 'bucket': BUCKET, 'last_success': latest,
            'source_age_hours': age_hours, 'fresh': age_hours is not None and 0 <= age_hours <= 30,
            'last_run': local.read_json(STATE / 'last-run.json') if (STATE / 'last-run.json').exists() else None,
            'pending_point': (STATE / 'pending.json').exists(),
            'local_only': False, 'restore_exercised': False}


def probe(s3, config):
    """One harmless encrypted object proves roundtrip and version-deletion protection."""
    path, journal = STATE / 'probe.age', STATE / 'probe.json'
    if journal.exists():
        record = local.read_json(journal)
        if (record.get('format') != FORMAT or record.get('recipient') != config['recipient']
                or not PROBE_KEY.fullmatch(record.get('key', ''))
                or not HEX.fullmatch(record.get('sha256', ''))):
            raise CloudError('PROBE_CONFIGURATION_CHANGED')
    else:
        result = subprocess.run(['age', '--encrypt', '-r', config['recipient']],
            input=b'OXUS backup storage capability check\n' + os.urandom(64), capture_output=True, timeout=30)
        if result.returncode or not result.stdout.startswith(b'age-encryption.org/v1\n'):
            raise CloudError('PROBE_ENCRYPTION_FAILED')
        if path.exists():
            local.private(path)
            path.unlink()
        with local.new_file(path) as output:
            output.write(result.stdout)
            output.flush()
            os.fsync(output.fileno())
        record = {'format': FORMAT, 'recipient': config['recipient'], 'key': PREFIX + 'checks/' + uuid.uuid4().hex + '.age',
                  'sha256': local.digest(path), 'size_bytes': path.stat().st_size,
                  'retain_until_utc': (now() + timedelta(days=7)).isoformat(), 'verified': False}
        local.write_json(journal, record)
    if local.private(path).st_size != record['size_bytes'] or local.digest(path) != record['sha256']:
        raise CloudError('PROBE_FILE_CHANGED')
    until = timestamp(record['retain_until_utc'])
    if until <= now() + timedelta(hours=1):
        raise CloudError('PROBE_EXPIRED_REVIEW_REQUIRED')
    version = upload_file(s3, path, record['key'], record['sha256'], until, STATE)
    retain(s3, record['key'], version, until)
    if download_hash(s3, record['key'], version, record['size_bytes']) != record['sha256']:
        raise CloudError('PROBE_ROUNDTRIP_HASH_MISMATCH')
    try:
        s3.delete_object(Bucket=BUCKET, Key=record['key'], VersionId=version)
    except Exception as error:
        if error_code(error) != 'AccessDenied':
            raise
    else:
        raise CloudError('OBJECT_LOCK_DID_NOT_REJECT_VERSION_DELETION')
    s3.head_object(Bucket=BUCKET, Key=record['key'], VersionId=version)
    record.update(verified=True, version_id=version, verified_at_utc=now().isoformat())
    local.write_json(journal, record)
    return {'status': 'CLOUD_WRITE_READ_LOCK_PROBE_PASS', 'bucket': BUCKET,
            'encrypted_probe_bytes': record['size_bytes'], 'cloud_writes': True,
            'compliance_days': 7, 'version_deletion_rejected': True}


def publish_pending(s3, config, manifest):
    pending = STATE / 'pending.json'
    if pending.exists():
        raise CloudError('ANOTHER_POINT_IS_PENDING')
    local.write_json(pending, {'format': FORMAT, 'manifest': manifest, 'recipient': config['recipient']})
    result = publish(s3, manifest, config)
    pending.unlink()
    local.sync_directory(STATE)
    return result


def run(s3, config):
    protections(s3)
    clean_multipart(s3)
    with local.deploy_lock(local.PROJECT):
        selected = selected_sources()
    readiness = local.read_json(STATE / 'probe.json')
    if readiness.get('verified') is not True or readiness.get('recipient') != config['recipient']:
        raise CloudError('SUCCESSFUL_CLOUD_PROBE_REQUIRED')
    published, uploaded = [], 0
    pending = STATE / 'pending.json'
    if pending.exists():
        work = local.read_json(pending)
        if work.get('format') != FORMAT or work.get('recipient') != config['recipient']:
            raise CloudError('INVALID_PENDING_POINT')
        validate_point(work['manifest'])
        directory = STATE / 'spool' / work['manifest']['name']
        if not (directory / 'prepared.json').exists() and not (SOURCE / 'snapshots' / work['manifest']['name']).exists():
            if directory.exists():
                clear_spool(directory)
        else:
            point, changed = publish(s3, work['manifest'], config)
            published.append(point)
            uploaded += changed
        pending.unlink()
        local.sync_directory(STATE)
    # A tracked pending point is always completed before starting another one.
    # This bounds local staging and prevents a new orphan archive on every failed day.
    if any((STATE / 'spool').iterdir()):
        raise CloudError('UNTRACKED_CLOUD_SPOOL_REVIEW_REQUIRED')
    for manifest in selected:
        point, changed = publish_pending(s3, config, manifest)
        published.append(point)
        uploaded += changed
    newest = max(published, key=lambda item: item['completed_at_utc'])
    local.write_json(STATE / 'last-success.json', newest)
    retention = prune(s3, {point['name'] for point in selected})
    return {'status': 'CLOUD_BACKUP_COMPLETE', 'environment': 'production', 'bucket': BUCKET,
            'newly_uploaded_points': uploaded, 'latest': newest['name'], **retention, 'restore_exercised': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('preflight', 'probe', 'run', 'status', 'verify'))
    args = parser.parse_args()
    os.umask(0o077)
    production_guard(check_containers=args.action != 'status')
    state_layout()
    config, credentials = target_config()
    if args.action == 'status':
        print(json.dumps(status()))
        return
    with job_lock():
        s3 = client(credentials)
        protections(s3)
        if args.action == 'preflight':
            if not shutil.which('age'):
                raise CloudError('AGE_NOT_INSTALLED')
            print(json.dumps({'status': 'CLOUD_PREFLIGHT_PASS', 'environment': 'production', 'bucket': BUCKET,
                              'cloud_writes': False, 'recipient': config['recipient'], 'lock_days': 7}))
        elif args.action == 'verify':
            latest = local.read_json(STATE / 'last-success.json')
            if download_hash(s3, latest['archive_key'], latest['archive_version'], latest['size_bytes']) != latest['sha256']:
                raise CloudError('CLOUD_DOWNLOAD_HASH_MISMATCH')
            print(json.dumps({'status': 'CLOUD_CIPHERTEXT_INTEGRITY_VERIFIED', 'name': latest['name'],
                              'restore_exercised': False}))
        elif args.action == 'probe':
            print(json.dumps(probe(s3, config)))
        else:
            try:
                result = run(s3, config)
            except Exception as error:
                reason = str(error) if isinstance(error, (CloudError, local.BackupError)) else error_code(error)
                local.write_json(STATE / 'last-run.json', {'status': 'FAILED', 'reason': reason, 'at_utc': now().isoformat()})
                raise
            local.write_json(STATE / 'last-run.json', {**result, 'at_utc': now().isoformat()})
            print(json.dumps(result))


if __name__ == '__main__':
    try:
        def interrupted(number, frame):
            raise CloudError('INTERRUPTED')
        signal.signal(signal.SIGTERM, interrupted)
        main()
    except (CloudError, local.BackupError) as error:
        print(json.dumps({'status': 'CLOUD_BACKUP_FAILED', 'reason': str(error)}))
        raise SystemExit(1)
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({'status': 'CLOUD_BACKUP_FAILED', 'reason': error_code(error)}))
        raise SystemExit(1)
