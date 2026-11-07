"""Cloud failure/retry/version-retention tests; all S3 operations use an in-memory server."""
import base64
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

DIRECTORY = Path(__file__).parents[1] / 'backup'
sys.path.insert(0, str(DIRECTORY))
import oxus_cloud_backup as cloud
local = cloud.local


class S3Error(Exception):
    def __init__(self, code):
        self.response = {'Error': {'Code': code, 'Message': 'synthetic hidden provider diagnostic'}}


class FakeS3:
    def __init__(self):
        self.objects, self.uploads, self.deleted = {}, {}, []
        self.sequence = 0
        self.reject_commits = False
        self.lose_commit_response_once = False
        self.fail_part_once = False
        self.omit_multipart_retention = False
        self.retention_puts = []

    def get_bucket_versioning(self, **kwargs):
        return {'Status': 'Enabled'}

    def get_object_lock_configuration(self, **kwargs):
        return {'ObjectLockConfiguration': {'ObjectLockEnabled': 'Enabled'}}

    def get_bucket_location(self, **kwargs):
        return {'LocationConstraint': 'kz'}

    def find(self, key, version=None):
        entries = self.objects.get(key, [])
        if version:
            entries = [entry for entry in entries if entry['VersionId'] == version]
        if not entries:
            raise S3Error('404')
        return entries[-1]

    def head_object(self, Bucket, Key, VersionId=None):
        entry = self.find(Key, VersionId)
        return {'VersionId': entry['VersionId'], 'ContentLength': len(entry['data']), 'Metadata': entry['metadata']}

    def put_object(self, Bucket, Key, Body, Metadata=None, ObjectLockMode=None,
                   ObjectLockRetainUntilDate=None, ContentMD5=None, **kwargs):
        if self.reject_commits and Key.endswith('complete.json'):
            raise S3Error('AccessDenied')
        data = Body.read() if hasattr(Body, 'read') else Body
        if ContentMD5:
            assert base64.b64encode(hashlib.md5(data).digest()).decode() == ContentMD5
        self.sequence += 1
        entry = {'VersionId': 'version-' + str(self.sequence), 'data': data, 'metadata': Metadata or {},
                 'mode': ObjectLockMode, 'until': ObjectLockRetainUntilDate, 'modified': cloud.now()}
        self.objects.setdefault(Key, []).append(entry)
        if self.lose_commit_response_once and Key.endswith('complete.json'):
            self.lose_commit_response_once = False
            raise S3Error('NetworkResponseLost')
        return {'VersionId': entry['VersionId']}

    def get_object(self, Bucket, Key, VersionId=None):
        return {'Body': io.BytesIO(self.find(Key, VersionId)['data'])}

    def get_object_retention(self, Bucket, Key, VersionId):
        entry = self.find(Key, VersionId)
        if entry['mode'] is None and entry['until'] is None:
            raise S3Error('ObjectLockConfigurationNotFoundError')
        return {'Retention': {'Mode': entry['mode'], 'RetainUntilDate': entry['until']}}

    def put_object_retention(self, Bucket, Key, VersionId, Retention):
        entry = self.find(Key, VersionId)
        if entry['until'] is not None and Retention['RetainUntilDate'] < entry['until']:
            raise S3Error('AccessDenied')
        self.retention_puts.append((Key, VersionId, Retention.copy()))
        entry['mode'], entry['until'] = Retention['Mode'], Retention['RetainUntilDate']
        return {}

    def delete_object(self, Bucket, Key, VersionId):
        assert VersionId
        entry = self.find(Key, VersionId)
        if entry['mode'] == 'COMPLIANCE' and entry['until'] > cloud.now():
            raise S3Error('AccessDenied')
        self.deleted.append((Key, VersionId))
        self.objects[Key].remove(entry)
        return {}

    def create_multipart_upload(self, **kwargs):
        identity = uuid.uuid4().hex
        self.uploads[identity] = {'args': kwargs, 'parts': {}, 'Initiated': cloud.now()}
        return {'UploadId': identity}

    def upload_part(self, UploadId, PartNumber, Body, ContentMD5, **kwargs):
        if self.fail_part_once:
            self.fail_part_once = False
            raise S3Error('NetworkInterrupted')
        assert base64.b64encode(hashlib.md5(Body).digest()).decode() == ContentMD5
        self.uploads[UploadId]['parts'][PartNumber] = Body
        return {'ETag': '"' + hashlib.md5(Body).hexdigest() + '"'}

    def complete_multipart_upload(self, UploadId, MultipartUpload, **kwargs):
        upload = self.uploads.pop(UploadId)
        data = b''.join(upload['parts'][part['PartNumber']] for part in MultipartUpload['Parts'])
        arguments = upload['args'].copy()
        if self.omit_multipart_retention:
            arguments.pop('ObjectLockMode', None)
            arguments.pop('ObjectLockRetainUntilDate', None)
        return self.put_object(**arguments, Body=data)

    def abort_multipart_upload(self, UploadId, **kwargs):
        if UploadId not in self.uploads:
            raise S3Error('NoSuchUpload')
        del self.uploads[UploadId]

    def get_paginator(self, name):
        def paginate(Bucket, Prefix):
            if name == 'list_object_versions':
                values = []
                for key, entries in self.objects.items():
                    if key.startswith(Prefix):
                        values.extend({'Key': key, 'VersionId': entry['VersionId'],
                                       'IsLatest': index == len(entries) - 1, 'LastModified': entry['modified']}
                                      for index, entry in enumerate(entries))
                return [{'Versions': values}]
            if name == 'list_multipart_uploads':
                return [{'Uploads': [{'Key': item['args']['Key'], 'UploadId': identity, 'Initiated': item['Initiated']}
                                     for identity, item in self.uploads.items() if item['args']['Key'].startswith(Prefix)]}]
            raise AssertionError(name)
        return SimpleNamespace(paginate=paginate)


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state, self.source, self.project = self.root / 'cloud', self.root / 'source', self.root / 'project'
        for directory in (self.state, self.source, self.project, self.state / 'spool', self.source / 'snapshots'):
            directory.mkdir(mode=0o700)
        (self.project / '.deploy.lock').touch(mode=0o600)
        self.clock = datetime(2026, 11, 25, 7, tzinfo=timezone.utc)
        for target, attribute, value in ((cloud, 'STATE', self.state), (cloud, 'SOURCE', self.source),
                                         (local, 'PROJECT', self.project), (local, 'OWNER', os.geteuid())):
            patcher = patch.object(target, attribute, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(cloud, 'now', side_effect=lambda: self.clock)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.config = {'recipient': 'age1' + 'q' * 58}
        self.s3 = FakeS3()

    def source_point(self, days=0):
        started = self.clock - timedelta(days=days, seconds=10)
        name = started.strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex
        directory = self.source / 'snapshots' / name
        directory.mkdir(mode=0o700)
        files = {}
        for filename in local.ARTIFACTS:
            item = directory / filename
            item.write_bytes(('synthetic ' + filename).encode() * 4)
            item.chmod(0o600)
            files[filename] = {'size_bytes': item.stat().st_size, 'sha256': local.digest(item)}
        manifest = {'format': local.FORMAT, 'environment': 'production', 'name': name,
                    'complete': True, 'services_resumed': True, 'date_almaty': started.astimezone(local.ALMATY).date().isoformat(),
                    'completed_at_utc': (started + timedelta(seconds=1)).isoformat(), 'files': files}
        local.write_json(directory / 'manifest.json', manifest)
        return manifest

    def remote_point(self, days, until=None):
        manifest = self.source_point(days)
        archive_key, receipt_key = cloud.keys(manifest['name'])
        until = until or self.clock - timedelta(hours=1)
        data = b'synthetic ciphertext for retention test'
        sha = hashlib.sha256(data).hexdigest()
        response = self.s3.put_object(Bucket=cloud.BUCKET, Key=archive_key, Body=data,
            Metadata={'sha256': sha}, ObjectLockMode='COMPLIANCE', ObjectLockRetainUntilDate=until)
        point = {key: manifest[key] for key in ('environment', 'name', 'date_almaty', 'completed_at_utc')}
        point.update(format=cloud.FORMAT, complete=True, archive_key=archive_key, archive_version=response['VersionId'],
                     recipient=self.config['recipient'], sha256=sha, size_bytes=len(data), retain_until_utc=until.isoformat())
        self.s3.put_object(Bucket=cloud.BUCKET, Key=receipt_key, Body=cloud.encoded(point),
                           ObjectLockMode='COMPLIANCE', ObjectLockRetainUntilDate=until)
        return point

    def fixture_key(self):
        if not shutil.which('age') or not shutil.which('age-keygen'):
            self.skipTest('Install age for real encryption/decryption integration checks')
        path = self.root / 'synthetic.agekey'
        with path.open('wb') as output:
            subprocess.run(['age-keygen'], stdout=output, stderr=subprocess.DEVNULL, check=True)
        path.chmod(0o600)
        recipient = subprocess.run(['age-keygen', '-y', str(path)], capture_output=True, check=True).stdout.decode().strip()
        self.config['recipient'] = recipient
        return path

    def readiness(self):
        local.write_json(self.state / 'probe.json', {'verified': True, 'recipient': self.config['recipient']})

    def test_unknown_target_names_and_future_manifest_are_rejected(self):
        for name in ('../../etc', 'test', ''):
            with self.assertRaises(cloud.CloudError):
                cloud.keys(name)
        manifest = self.source_point()
        manifest['completed_at_utc'] = (self.clock + timedelta(days=1)).isoformat()
        with self.assertRaises(cloud.CloudError):
            cloud.validate_point(manifest)

    def test_local_encryption_survives_source_retention_and_roundtrips(self):
        identity = self.fixture_key()
        manifest = self.source_point()
        original = {filename: (self.source / 'snapshots' / manifest['name'] / filename).read_bytes() for filename in local.ARTIFACTS}
        target = self.state / 'spool' / manifest['name']
        target.mkdir(mode=0o700)
        original_read = cloud.HashReader.read
        deleted = []
        def read_and_prune(reader, size=-1):
            if not deleted:
                descriptor = os.open(self.project / '.deploy.lock', os.O_RDONLY)
                try:
                    import fcntl
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    shutil.rmtree(self.source / 'snapshots' / manifest['name'])
                    deleted.append(True)
                finally:
                    os.close(descriptor)
            return original_read(reader, size)
        with patch.object(cloud.HashReader, 'read', read_and_prune):
            saved, cipher = cloud.encrypt_point(manifest['name'], self.config, target)
        self.assertTrue(cipher.read_bytes().startswith(b'age-encryption.org/v1\n'))
        decrypted = subprocess.run(['age', '--decrypt', '-i', str(identity), str(cipher)], capture_output=True, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(decrypted)) as archive:
            for filename, contents in original.items():
                self.assertEqual(archive.extractfile(manifest['name'] + '/' + filename).read(), contents)
            self.assertEqual(json.load(archive.extractfile(manifest['name'] + '/manifest.json')), manifest)
        self.assertTrue(deleted)

    def test_corrupt_source_is_never_published(self):
        self.fixture_key()
        manifest = self.source_point()
        path = self.source / 'snapshots' / manifest['name'] / 'database.dump'
        path.write_bytes(b'x' * path.stat().st_size)
        with self.assertRaisesRegex(cloud.CloudError, 'SOURCE_HASH_MISMATCH'):
            cloud.publish_pending(self.s3, self.config, manifest)
        self.assertFalse(self.s3.objects)

    def test_upload_commit_roundtrip_is_idempotent_and_deletes_no_locked_versions(self):
        self.fixture_key()
        manifest = self.source_point()
        first, changed = cloud.publish_pending(self.s3, self.config, manifest)
        self.assertTrue(changed)
        second, changed = cloud.publish_pending(self.s3, self.config, manifest)
        self.assertFalse(changed)
        self.assertEqual(first, second)
        self.assertEqual(sum(map(len, self.s3.objects.values())), 2)
        self.assertFalse(list((self.state / 'spool').iterdir()))
        with self.assertRaises(S3Error):
            self.s3.delete_object(Bucket=cloud.BUCKET, Key=first['archive_key'], VersionId=first['archive_version'])

    def test_response_lost_after_commit_recovers_without_new_ciphertext_or_source(self):
        self.fixture_key()
        self.readiness()
        manifest = self.source_point()
        self.s3.lose_commit_response_once = True
        with self.assertRaises(S3Error):
            cloud.run(self.s3, self.config)
        archive_key, _ = cloud.keys(manifest['name'])
        expected_version = self.s3.find(archive_key)['VersionId']
        shutil.rmtree(self.source / 'snapshots' / manifest['name'])
        self.clock += timedelta(hours=1)
        self.source_point()
        result = cloud.run(self.s3, self.config)
        self.assertEqual(result['status'], 'CLOUD_BACKUP_COMPLETE')
        self.assertEqual(self.s3.find(archive_key)['VersionId'], expected_version)
        self.assertFalse((self.state / 'pending.json').exists())
        self.assertFalse(list((self.state / 'spool').iterdir()))

    def test_uploads_with_omitted_response_version_id_are_resolved_by_head_without_reupload(self):
        self.fixture_key()
        manifest = self.source_point()
        original_put = self.s3.put_object
        def put_without_response_version(**kwargs):
            original_put(**kwargs)
            return {}
        with patch.object(self.s3, 'put_object', side_effect=put_without_response_version):
            point, changed = cloud.publish_pending(self.s3, self.config, manifest)
        self.assertTrue(changed)
        self.assertEqual(point['archive_version'], self.s3.find(point['archive_key'])['VersionId'])
        self.assertEqual(sum(map(len, self.s3.objects.values())), 2)

    def test_persistent_commit_failure_does_not_accumulate_daily_orphan_archives(self):
        self.fixture_key()
        self.readiness()
        manifest = self.source_point()
        self.s3.reject_commits = True
        for _ in range(3):
            with self.assertRaises(S3Error):
                cloud.run(self.s3, self.config)
            self.clock += timedelta(days=1)
            self.source_point()
        self.assertEqual(len(self.s3.objects), 1)
        self.assertEqual(len(list((self.state / 'spool').iterdir())), 1)
        self.assertEqual(local.read_json(self.state / 'pending.json')['manifest']['name'], manifest['name'])

    def test_multipart_failure_aborts_previous_attempt_and_reuses_encrypted_file(self):
        self.fixture_key()
        self.readiness()
        manifest = self.source_point()
        self.s3.fail_part_once = True
        with patch.object(cloud, 'PART_SIZE', 4096):
            with self.assertRaises(S3Error):
                cloud.run(self.s3, self.config)
            before = local.digest(self.state / 'spool' / manifest['name'] / 'archive.tar.age')
            self.assertEqual(len(self.s3.uploads), 1)
            result = cloud.run(self.s3, self.config)
        self.assertEqual(result['status'], 'CLOUD_BACKUP_COMPLETE')
        self.assertFalse(self.s3.uploads)
        archive_key, _ = cloud.keys(manifest['name'])
        self.assertEqual(hashlib.sha256(self.s3.find(archive_key)['data']).hexdigest(), before)

    def test_real_encrypted_probe_proves_hash_and_lock_before_any_production_archive(self):
        self.fixture_key()
        result = cloud.probe(self.s3, self.config)
        self.assertEqual(result['status'], 'CLOUD_WRITE_READ_LOCK_PROBE_PASS')
        self.assertTrue(local.read_json(self.state / 'probe.json')['verified'])
        self.assertEqual(len(self.s3.objects), 1)
        self.assertTrue(next(iter(self.s3.objects)).startswith(cloud.PREFIX + 'checks/'))

    def test_multipart_without_retention_is_locked_and_verified_before_commit(self):
        self.fixture_key()
        self.readiness()
        manifest = self.source_point()
        self.s3.omit_multipart_retention = True
        with patch.object(cloud, 'PART_SIZE', 4096):
            result = cloud.run(self.s3, self.config)
        self.assertEqual(result['status'], 'CLOUD_BACKUP_COMPLETE')
        archive_key, receipt_key = cloud.keys(manifest['name'])
        archive = self.s3.find(archive_key)
        receipt = cloud.remote_receipt(self.s3, receipt_key)
        self.assertEqual(receipt['archive_version'], archive['VersionId'])
        self.assertEqual(archive['mode'], 'COMPLIANCE')
        self.assertGreaterEqual(archive['until'], self.clock + timedelta(days=7))
        self.assertEqual(len(self.s3.retention_puts), 1)
        self.assertEqual(len(self.s3.objects[archive_key]), 1)
        with self.assertRaises(S3Error):
            self.s3.delete_object(Bucket=cloud.BUCKET, Key=archive_key, VersionId=archive['VersionId'])

    def test_failed_lock_update_keeps_pending_archive_and_retry_does_not_reupload(self):
        self.fixture_key()
        self.readiness()
        manifest = self.source_point()
        self.s3.omit_multipart_retention = True
        with patch.object(cloud, 'PART_SIZE', 4096), \
             patch.object(self.s3, 'put_object_retention', side_effect=S3Error('AccessDenied')):
            with self.assertRaises(S3Error):
                cloud.run(self.s3, self.config)
        archive_key, receipt_key = cloud.keys(manifest['name'])
        original = self.s3.find(archive_key).copy()
        self.assertNotIn(receipt_key, self.s3.objects)
        self.assertFalse((self.state / 'last-success.json').exists())
        self.assertTrue((self.state / 'pending.json').exists())
        self.clock += timedelta(minutes=5)
        with patch.object(cloud, 'encrypt_point', side_effect=AssertionError('must reuse ciphertext')), \
             patch.object(self.s3, 'put_object', wraps=self.s3.put_object) as put:
            result = cloud.run(self.s3, self.config)
        self.assertEqual(result['status'], 'CLOUD_BACKUP_COMPLETE')
        self.assertEqual([call.kwargs['Key'] for call in put.call_args_list], [receipt_key])
        self.assertEqual(len(self.s3.objects[archive_key]), 1)
        self.assertEqual(self.s3.find(archive_key)['VersionId'], original['VersionId'])
        self.assertEqual(self.s3.find(archive_key)['data'], original['data'])
        self.assertFalse((self.state / 'pending.json').exists())

    def test_lock_update_requires_successful_readback_before_commit(self):
        self.fixture_key()
        manifest = self.source_point()
        self.s3.omit_multipart_retention = True
        with patch.object(cloud, 'PART_SIZE', 4096), \
             patch.object(self.s3, 'put_object_retention', return_value={}):
            with self.assertRaises(S3Error):
                cloud.publish_pending(self.s3, self.config, manifest)
        _, receipt_key = cloud.keys(manifest['name'])
        self.assertNotIn(receipt_key, self.s3.objects)
        self.assertFalse((self.state / 'last-success.json').exists())

    def test_retention_access_failure_is_not_treated_as_missing_lock(self):
        self.fixture_key()
        manifest = self.source_point()
        with patch.object(self.s3, 'get_object_retention', side_effect=S3Error('AccessDenied')):
            with self.assertRaises(S3Error):
                cloud.publish_pending(self.s3, self.config, manifest)
        self.assertFalse(self.s3.retention_puts)
        _, receipt_key = cloud.keys(manifest['name'])
        self.assertNotIn(receipt_key, self.s3.objects)

    def test_archive_retention_never_shortens_or_changes_unexpected_existing_lock(self):
        point = self.remote_point(0, until=self.clock + timedelta(days=14))
        key, version = point['archive_key'], point['archive_version']
        minimum = self.clock + timedelta(days=7)
        until = cloud.ensure_archive_retention(self.s3, key, version, minimum)
        self.assertEqual(until, self.clock + timedelta(days=14))
        self.assertFalse(self.s3.retention_puts)
        for mode, expiry in [('GOVERNANCE', until), ('COMPLIANCE', None),
                             ('COMPLIANCE', minimum.replace(tzinfo=None))]:
            with self.subTest(mode=mode, expiry=expiry):
                entry = self.s3.find(key, version)
                entry['mode'], entry['until'] = mode, expiry
                with self.assertRaisesRegex(cloud.CloudError, 'UNEXPECTED_ARCHIVE_RETENTION'):
                    cloud.ensure_archive_retention(self.s3, key, version, minimum)
                self.assertFalse(self.s3.retention_puts)

    def test_prune_keeps_seven_dates_and_last_sunday_and_removes_expired_versions(self):
        points = [self.remote_point(day) for day in range(12) if (self.clock - timedelta(days=day)).astimezone(local.ALMATY).weekday() != 6]
        points.append(self.remote_point(17))  # the last successfully published Sunday is outside the daily set
        result = cloud.prune(self.s3, set())
        keep = local.retention_keep(points)
        self.assertEqual(result['retained_points'], 8)
        for point in points:
            _, receipt_key = cloud.keys(point['name'])
            self.assertEqual(bool(self.s3.objects[receipt_key]), point['name'] in keep)
        self.assertTrue(self.s3.deleted)
        self.assertTrue(all(version for _, version in self.s3.deleted))

    def test_unexpired_retired_point_is_deferred_and_removed_after_unlock(self):
        points = [self.remote_point(day) for day in range(9)]
        retired = points[-1]
        for key in cloud.keys(retired['name']):
            self.s3.find(key)['until'] = self.clock + timedelta(hours=1)
        result = cloud.prune(self.s3, set())
        self.assertEqual(result['retired_groups_still_locked'], 1)
        self.assertTrue(self.s3.objects[retired['archive_key']])
        self.clock += timedelta(hours=2)
        cloud.prune(self.s3, set())
        self.assertFalse(self.s3.objects[retired['archive_key']])

    def test_noncurrent_versions_of_retained_point_do_not_accumulate(self):
        point = self.remote_point(0)
        key = point['archive_key']
        old = self.s3.find(key).copy()
        old['VersionId'] = 'obsolete-version'
        self.s3.objects[key].insert(0, old)
        result = cloud.prune(self.s3, set())
        self.assertEqual(result['expired_versions_deleted'], 1)
        self.assertEqual(self.s3.objects[key][0]['VersionId'], point['archive_version'])

    def test_unknown_managed_key_aborts_all_deletions(self):
        for day in range(9):
            self.remote_point(day)
        self.s3.put_object(Bucket=cloud.BUCKET, Key=cloud.PREFIX + 'unexpected', Body=b'synthetic')
        with self.assertRaisesRegex(cloud.CloudError, 'UNRECOGNIZED_MANAGED_REMOTE_KEY'):
            cloud.prune(self.s3, set())
        self.assertFalse(self.s3.deleted)

    def test_expired_receipts_are_removed_before_archives_so_interrupted_cleanup_is_resumable(self):
        points = [self.remote_point(day) for day in range(9)]
        original_delete = self.s3.delete_object
        stop = []
        def delete_then_interrupt(**kwargs):
            original_delete(**kwargs)
            if not stop:
                stop.append(kwargs['Key'])
                raise S3Error('NetworkResponseLost')
        with patch.object(self.s3, 'delete_object', side_effect=delete_then_interrupt):
            with self.assertRaises(S3Error):
                cloud.prune(self.s3, set())
        self.assertTrue(stop[0].endswith('/complete.json'))
        result = cloud.prune(self.s3, set())
        self.assertEqual(result['retained_points'], 7)

    def test_stale_local_source_does_not_publish_or_prune(self):
        self.source_point(2)
        self.readiness()
        with self.assertRaisesRegex(cloud.CloudError, 'OLDER_THAN_30_HOURS'):
            cloud.run(self.s3, self.config)
        self.assertFalse(self.s3.objects)
        self.assertFalse(self.s3.deleted)

    def test_test_environment_is_rejected_before_container_or_network_access(self):
        with patch.object(cloud.sys, 'platform', 'linux'), patch.object(cloud.os, 'geteuid', return_value=0), \
             patch.object(local, 'store_layout'), \
             patch.object(local, 'read_json', return_value={'environment': 'test', 'name': self.source_point()['name']}), \
             patch.object(local, 'containers') as containers:
            with self.assertRaisesRegex(cloud.CloudError, 'PRODUCTION_SOURCE_NOT_CONFIRMED'):
                cloud.production_guard()
            containers.assert_not_called()

    def test_offline_download_verifier_decrypts_all_files_without_network_or_docker(self):
        identity = self.fixture_key()
        manifest = self.source_point()
        directory = self.state / 'spool' / manifest['name']
        directory.mkdir(mode=0o700)
        _, cipher = cloud.encrypt_point(manifest['name'], self.config, directory)
        destination = self.root / 'verified'
        result = subprocess.run([sys.executable, str(DIRECTORY / 'verify-cloud-download.py'),
            '--archive', str(cipher), '--identity', str(identity), '--destination', str(destination),
            '--sha256', local.digest(cipher)], capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout.decode())
        report = json.loads(result.stdout)
        self.assertEqual(report['status'], 'CLOUD_DOWNLOAD_DECRYPTED_AND_FILES_VERIFIED')
        self.assertFalse(report['application_restore_exercised'])
        self.assertEqual(len(list(destination.iterdir())), 6)

    def test_offline_verifier_rejects_tampered_ciphertext_before_creating_destination(self):
        identity = self.fixture_key()
        cipher = self.root / 'tampered.age'
        cipher.write_bytes(b'synthetic corrupted ciphertext')
        destination = self.root / 'must-not-exist'
        result = subprocess.run([sys.executable, str(DIRECTORY / 'verify-cloud-download.py'),
            '--archive', str(cipher), '--identity', str(identity), '--destination', str(destination),
            '--sha256', '0' * 64], capture_output=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(destination.exists())


class SDKCompatibilityTests(unittest.TestCase):
    def test_sdk_missing_retention_is_set_on_exact_version_and_read_back(self):
        try:
            from botocore.stub import Stubber
        except ImportError:
            self.skipTest('Run also in the isolated boto3 compatibility environment')
        s3 = cloud.client({'access_key_id': 'synthetic-access', 'secret_access_key': 'synthetic-secret'})
        until = datetime(2026, 12, 1, tzinfo=timezone.utc)
        target = {'Bucket': cloud.BUCKET, 'Key': 'synthetic', 'VersionId': 'version-1'}
        with Stubber(s3) as stub:
            stub.add_client_error('get_object_retention', service_error_code='ObjectLockConfigurationNotFoundError',
                                  http_status_code=404, expected_params=target)
            stub.add_response('put_object_retention', {},
                              {**target, 'Retention': {'Mode': 'COMPLIANCE', 'RetainUntilDate': until}})
            stub.add_response('get_object_retention', {'Retention': {'Mode': 'COMPLIANCE', 'RetainUntilDate': until}}, target)
            self.assertEqual(cloud.ensure_archive_retention(s3, 'synthetic', 'version-1', until), until)
            stub.assert_no_pending_responses()
        self.assertEqual(cloud.error_code(S3Error('ObjectLockConfigurationNotFoundError')),
                         'ObjectLockConfigurationNotFoundError')

    def test_sdk_serializes_lock_and_versioned_operations_without_contacting_ps(self):
        try:
            from botocore.stub import Stubber
        except ImportError:
            self.skipTest('Run also in the isolated boto3 compatibility environment')
        s3 = cloud.client({'access_key_id': 'synthetic-access', 'secret_access_key': 'synthetic-secret'})
        self.assertEqual(s3.meta.endpoint_url, cloud.ENDPOINT)
        self.assertEqual(s3.meta.config.s3['addressing_style'], 'path')
        until = datetime(2026, 12, 1, tzinfo=timezone.utc)
        with Stubber(s3) as stub:
            stub.add_response('get_bucket_versioning', {'Status': 'Enabled'}, {'Bucket': cloud.BUCKET})
            stub.add_response('get_object_lock_configuration', {'ObjectLockConfiguration': {'ObjectLockEnabled': 'Enabled'}}, {'Bucket': cloud.BUCKET})
            stub.add_response('get_bucket_location', {'LocationConstraint': 'kz'}, {'Bucket': cloud.BUCKET})
            cloud.protections(s3)
            stub.add_response('get_object_retention', {'Retention': {'Mode': 'COMPLIANCE', 'RetainUntilDate': until}},
                              {'Bucket': cloud.BUCKET, 'Key': 'synthetic', 'VersionId': 'version-1'})
            self.assertEqual(cloud.retain(s3, 'synthetic', 'version-1', until), until)
            stub.add_response('put_object', {'VersionId': 'version-1'},
                {'Bucket': cloud.BUCKET, 'Key': 'synthetic', 'Body': b'ciphertext', 'ContentMD5': 'synthetic',
                 'ObjectLockMode': 'COMPLIANCE', 'ObjectLockRetainUntilDate': until, 'Metadata': {'sha256': 'a' * 64}})
            s3.put_object(Bucket=cloud.BUCKET, Key='synthetic', Body=b'ciphertext', ContentMD5='synthetic',
                          ObjectLockMode='COMPLIANCE', ObjectLockRetainUntilDate=until, Metadata={'sha256': 'a' * 64})
            stub.assert_no_pending_responses()


if __name__ == '__main__':
    unittest.main()
