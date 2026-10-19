"""Failure, recovery and retention tests; no real Production or Docker targets."""
import contextlib
from datetime import datetime, timedelta, timezone
import fcntl
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

SPEC = importlib.util.spec_from_file_location("oxus_backup", Path(__file__).parents[1] / "backup/oxus_backup.py")
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)


class ConfigurationTests(unittest.TestCase):
    def test_environment_must_match_staging_before_either_target_is_used(self):
        database = {"POSTGRES_DB": "synthetic", "POSTGRES_USER": "fixture", "POSTGRES_PASSWORD": "synthetic-password"}
        app = {"DATABASE_URL": "postgresql://fixture:synthetic-password@db:5432/synthetic",
               "AWS_MINIO_ENDPOINT": "http://minio:9000"}
        for environment_name, staging in (("production", "false"), ("test", "true")):
            with self.subTest(environment=environment_name):
                backup.check_target({**app, "STAGING": staging}, database, environment_name)
                wrong_staging = "true" if staging == "false" else "false"
                with self.assertRaisesRegex(backup.BackupError, "ENVIRONMENT_TARGET_MISMATCH"):
                    backup.check_target({**app, "STAGING": wrong_staging}, database, environment_name)
                with self.assertRaisesRegex(backup.BackupError, "ENVIRONMENT_TARGET_MISMATCH"):
                    backup.check_target({**app, "STAGING": staging, "DATABASE_URL": "postgresql://fixture@external/synthetic"},
                                        database, environment_name)

    def test_cli_preflight_selects_separate_store_and_explicit_environment(self):
        result = {"database": {"size_bytes": 123}, "storage_bytes": 456, "redis_keys": 2, "reserve_bytes": 1024**3}
        for environment_name in ("production", "test"):
            output = io.StringIO()
            with self.subTest(environment=environment_name), \
                    patch("sys.argv", ["oxus_backup.py", "preflight", "--environment", environment_name]), \
                    patch.object(backup, "inventory", return_value=result) as inventory, contextlib.redirect_stdout(output):
                backup.main()
                inventory.assert_called_once_with(backup.PROJECT, backup.STORE / environment_name, environment_name)
                self.assertEqual(json.loads(output.getvalue())["environment"], environment_name)

    def test_existing_readonly_uid1001_jitsi_key_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            for name in (".env", "compose.yaml", "compose.override.yaml", "deploy.sh", "jitsi-private-key.pk"):
                (project / name).write_text("synthetic configuration")
                (project / name).chmod(0o600)
            original = Path.lstat
            def metadata(path):
                if path.name == "jitsi-private-key.pk":
                    return SimpleNamespace(st_mode=stat.S_IFREG | 0o400, st_uid=1001)
                return SimpleNamespace(st_mode=original(path).st_mode, st_uid=0)
            with patch.object(backup, "OWNER", 0), patch.object(Path, "lstat", metadata):
                result = backup.configuration_files(project)
            self.assertEqual(len(result), 5)
            self.assertEqual(stat.S_IMODE((project / "jitsi-private-key.pk").stat().st_mode), 0o600)
            # Only the known read-only Jitsi key receives the ownership exception.
            for filename, mode in ((".env", 0o400), ("jitsi-private-key.pk", 0o600),
                                   ("jitsi-private-key.pk", 0o444), ("jitsi-private-key.pk", 0o777)):
                def unsafe_metadata(path):
                    if path.name == filename:
                        return SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=1001)
                    return metadata(path)
                with self.subTest(filename=filename, mode=mode), patch.object(backup, "OWNER", 0), \
                        patch.object(Path, "lstat", unsafe_metadata):
                    with self.assertRaisesRegex(backup.BackupError, "UNSAFE_PROJECT_CONFIGURATION"):
                        backup.configuration_files(project)

    def test_minio_backup_rejects_additional_data_paths_and_remote_endpoints(self):
        backup.check_minio_command(["server", "/data", "--console-address", ":9090"])
        for arguments in (["server", "/data", "/data2"], ["server", "/data", "http://other/data"],
                          ["server", "/data", "--config-dir", "/elsewhere"], ["server", "/data1"]):
            with self.subTest(arguments=arguments), self.assertRaisesRegex(backup.BackupError, "UNSUPPORTED_MINIO_TOPOLOGY"):
                backup.check_minio_command(arguments)

    def test_minio_image_default_secret_filename_requires_absent_file(self):
        item = {"Id": "synthetic-minio", "Config": {"Env": [
            "MINIO_KMS_SECRET_KEY_FILE=kms_master_key", "MINIO_CONFIG_ENV_FILE=config.env",
            "MINIO_ROOT_USER_FILE=access_key", "MINIO_ROOT_PASSWORD_FILE=secret_key"]}}
        with patch.object(backup, "docker", return_value=b"ABSENT") as docker:
            backup.check_minio_dependencies(item)
        self.assertEqual(docker.call_args.args[-4:], ("access_key", "config.env", "kms_master_key", "secret_key"))
        self.assertNotIn("cat ", docker.call_args.args[4])
        with patch.object(backup, "docker", return_value=b"PRESENT"), \
                self.assertRaisesRegex(backup.BackupError, "EXTERNAL_MINIO_RECOVERY_DEPENDENCY"):
            backup.check_minio_dependencies(item)

    def test_minio_file_probe_detects_existing_file_and_broken_symlink(self):
        item = {"Id": "synthetic-minio", "Config": {"Env": ["MINIO_KMS_SECRET_KEY_FILE=kms_master_key"]}}
        with tempfile.TemporaryDirectory() as temporary:
            def probe(*arguments):
                self.assertEqual(arguments[:4], ("exec", "synthetic-minio", "sh", "-ec"))
                return subprocess.check_output(["sh", "-ec", *arguments[4:]], cwd=temporary)
            path = Path(temporary) / "kms_master_key"
            with patch.object(backup, "docker", side_effect=probe):
                backup.check_minio_dependencies(item)
                path.write_text("synthetic-key-not-to-be-read")
                with self.assertRaisesRegex(backup.BackupError, "EXTERNAL_MINIO_RECOVERY_DEPENDENCY"):
                    backup.check_minio_dependencies(item)
                path.unlink()
                path.symlink_to("missing-key")
                with self.assertRaisesRegex(backup.BackupError, "EXTERNAL_MINIO_RECOVERY_DEPENDENCY"):
                    backup.check_minio_dependencies(item)

    def test_real_minio_dependencies_remain_blocked_without_exposing_values(self):
        for setting in ("MINIO_KMS_SECRET_KEY=synthetic-private-key",
                        "MINIO_KMS_SECRET_KEY_FILE=/run/secrets/private-key",
                        "MINIO_IDENTITY_LDAP_SERVER_ADDR=private-host",
                        "MINIO_ETCD_ENDPOINTS=private-host", "MINIO_VOLUMES=/other-data",
                        "MINIO_CONFIG_ENV_FILE=/private/config.env"):
            item = {"Id": "synthetic-minio", "Config": {"Env": [setting]}}
            with self.subTest(key=setting.split("=", 1)[0]), patch.object(backup, "docker") as docker:
                with self.assertRaises(backup.BackupError) as error:
                    backup.check_minio_dependencies(item)
                self.assertEqual(str(error.exception), "EXTERNAL_MINIO_RECOVERY_DEPENDENCY")
                docker.assert_not_called()


class Fixture:
    def __init__(self, root):
        self.root = root
        self.project = root / "deployment"
        self.project.mkdir(mode=0o700)
        (self.project / ".deploy.lock").write_bytes(b"")
        (self.project / ".deploy.lock").chmod(0o600)
        self.store = root / "backups"
        self.store.mkdir(mode=0o700)
        (self.store / ".format").write_text(backup.FORMAT + "\n")
        (self.store / ".format").chmod(0o600)
        for name in ("snapshots", ".partial", ".trash", "operations"):
            (self.store / name).mkdir(mode=0o700)
        self.storage = root / "minio"
        self.storage.mkdir()
        (self.storage / ".minio.sys").mkdir()
        (self.storage / ".minio.sys" / "format.json").write_bytes(b"synthetic internal metadata")
        (self.storage / "file.pdf").write_bytes(b"%PDF synthetic private document")
        self.redis = root / "redis"
        self.redis.mkdir()
        (self.redis / "dump.rdb").write_bytes(b"REDIS0012synthetic queue bytes")
        self.services = {
            name: {"Id": character * 64, "Image": "sha256:" + character * 64,
                   "Config": {"Image": "fixture:local"},
                   "State": {"Running": True, "Health": {"Status": "healthy"}, "ExitCode": 0}}
            for name, character in zip(("backend", "db", "minio", "redis"), "abcd")
        }
        self.calls = []
        self.fail_dump = False
        self.interrupt_dump = False
        self.fail_minio_start = False
        self.lost_start_ack = False
        self.unclean_stop = False
        self.other_clients = 0
        self.plan = {"services": self.services, "database": {"name": "fixture", "owner": "fixture_owner", "size_bytes": 1024, "version": "160000"},
                     "storage": self.storage, "storage_bytes": 128, "redis_data": self.redis}

    def docker(self, *args, **kwargs):
        self.calls.append(args)
        item = next((value for value in self.services.values() if value["Id"] in args), None)
        if args[0] == "stop":
            item["State"]["Running"] = False
            item["State"]["ExitCode"] = 137 if self.unclean_stop else 0
        elif args[0] == "start":
            if item is self.services["minio"] and self.fail_minio_start:
                raise backup.BackupError("COMMAND_FAILED")
            item["State"]["Running"] = True
            if self.lost_start_ack:
                raise backup.BackupError("COMMAND_INCOMPLETE")
        elif args[0] == "exec" and "output" in kwargs and kwargs["output"] != -3:
            if self.interrupt_dump:
                raise backup.BackupError("INTERRUPTED")
            if self.fail_dump:
                raise backup.BackupError("COMMAND_FAILED")
            text = args[-1]
            kwargs["output"].write(b"PGDMPsynthetic archive" if "pg_dump " in text else b"-- synthetic roles only\n")
        return b""

    def current(self, name, original):
        item = self.services[name]
        if item["Id"] != original["id"] or item["Image"] != original["image"]:
            raise backup.BackupError("ORIGINAL_CONTAINER_CHANGED")
        return item

    def wait(self, name, original, timeout=90):
        if not backup.healthy(self.current(name, original)):
            raise backup.BackupError("SERVICE_RESUME_UNCONFIRMED")

    def config_tar(self, project, target):
        with backup.new_file(target) as stream, tarfile.open(fileobj=stream, mode="w:gz") as archive:
            entry = tarfile.TarInfo("deployment/.env")
            data = b"SYNTHETIC_SECRET=not-for-logs\n"
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))

    @contextlib.contextmanager
    def patched(self):
        with contextlib.ExitStack() as stack:
            for name, value in {
                "OWNER": os.getuid(), "trusted_directory": lambda path: None,
                "inventory": lambda project, store, environment_name="production": self.plan,
                "docker": self.docker, "current_original": self.current, "wait_healthy": self.wait,
                "sql": lambda *args: str(self.other_clients), "redis_command": lambda *args, **kwargs: "OK",
                "tar_configuration": self.config_tar,
            }.items():
                stack.enter_context(patch.object(backup, name, value))
            yield self

    def assert_running(self, testcase):
        testcase.assertTrue(all(item["State"]["Running"] for item in self.services.values()))

    def snapshot(self, when):
        name = when.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
        path = self.store / "snapshots" / name
        path.mkdir(mode=0o700)
        files = {}
        for filename in backup.ARTIFACTS:
            item = path / filename
            item.write_bytes(b"synthetic retained checkpoint")
            item.chmod(0o600)
            files[filename] = {"size_bytes": item.stat().st_size, "sha256": backup.digest(item)}
        manifest = {"format": backup.FORMAT, "name": name, "environment": "production", "complete": True, "services_resumed": True,
                    "date_almaty": when.astimezone(backup.ALMATY).date().isoformat(),
                    "completed_at_utc": when.isoformat(), "files": files}
        backup.write_json(path / "manifest.json", manifest)
        return path


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.fixture = Fixture(Path(self.temporary.name))
        self.patch = self.fixture.patched()
        self.patch.__enter__()

    def tearDown(self):
        self.patch.__exit__(None, None, None)
        self.temporary.cleanup()

    def test_test_environment_uses_same_backup_flow_and_labels_manifest(self):
        f = self.fixture
        result = backup.run_backup(f.project, f.store, "test")
        self.assertEqual(result["environment"], "test")
        point = f.store / "snapshots" / result["name"]
        self.assertEqual(backup.verify_snapshot(point)["environment"], "test")
        self.assertEqual(backup.read_json(f.store / "last-success.json")["environment"], "test")
        f.assert_running(self)

    def test_recovery_refuses_the_other_environment_before_starting_anything(self):
        f = self.fixture
        f.fail_minio_start = True
        with self.assertRaises(backup.BackupError):
            backup.run_backup(f.project, f.store, "test")
        f.calls.clear()
        with self.assertRaisesRegex(backup.BackupError, "RECOVERY_ENVIRONMENT_MISMATCH"):
            backup.recover(f.project, f.store, "production")
        self.assertEqual(f.calls, [])
        f.fail_minio_start = False
        backup.recover(f.project, f.store, "test")
        f.assert_running(self)

    def test_complete_copy_resumes_before_verification_and_preserves_storage_metadata(self):
        f = self.fixture
        original = backup.verify_tar
        def verified_after_resume(*args, **kwargs):
            f.assert_running(self)
            return original(*args, **kwargs)
        with patch.object(backup, "verify_tar", side_effect=verified_after_resume):
            result = backup.run_backup(f.project, f.store)
        self.assertEqual(result["status"], "LOCAL_BACKUP_COMPLETE")
        self.assertFalse(result["restore_exercised"])
        f.assert_running(self)
        self.assertFalse((f.store / "active.json").exists())
        point = f.store / "snapshots" / result["name"]
        backup.verify_snapshot(point)
        with tarfile.open(point / "minio-data.tar.gz") as archive:
            self.assertEqual(archive.extractfile("data/.minio.sys/format.json").read(), b"synthetic internal metadata")
            self.assertEqual(archive.extractfile("data/file.pdf").read(), b"%PDF synthetic private document")
        stopped = [call[-1] for call in f.calls if call[0] == "stop"]
        started = [call[-1] for call in f.calls if call[0] == "start"]
        self.assertEqual(stopped, [f.services["backend"]["Id"], f.services["minio"]["Id"]])
        self.assertEqual(started, list(reversed(stopped)))
        for path in point.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertNotIn("SYNTHETIC_SECRET", json.dumps(result))

    def test_failed_dump_retains_prior_points_and_resumes_originals(self):
        f = self.fixture
        previous = f.snapshot(datetime.now(timezone.utc) - timedelta(days=1))
        f.fail_dump = True
        with self.assertRaisesRegex(backup.BackupError, "BACKUP_FAILED_SERVICES_RESUMED"):
            backup.run_backup(f.project, f.store)
        f.assert_running(self)
        self.assertTrue(previous.exists())
        self.assertEqual(len(list((f.store / ".partial").iterdir())), 1)
        self.assertFalse((f.store / "last-success.json").exists())
        self.assertFalse((f.store / "active.json").exists())
        operation = next((f.store / "operations").iterdir())
        self.assertEqual(backup.read_json(operation)["failed_phase"], "DATABASE")
        self.assertEqual(backup.read_json(operation)["failure_reason"], "COMMAND_FAILED")

    def test_interrupt_resumes_originals_without_publishing_partial_backup(self):
        f = self.fixture
        f.interrupt_dump = True
        with self.assertRaises(backup.BackupError):
            backup.run_backup(f.project, f.store)
        f.assert_running(self)
        self.assertFalse(list((f.store / "snapshots").iterdir()))

    def test_unclean_stop_never_publishes_a_checkpoint(self):
        f = self.fixture
        f.unclean_stop = True
        with self.assertRaises(backup.BackupError):
            backup.run_backup(f.project, f.store)
        f.assert_running(self)
        self.assertFalse(list((f.store / "snapshots").iterdir()))

    def test_failure_to_resume_minio_keeps_backend_stopped_and_journal_for_recovery(self):
        f = self.fixture
        f.fail_minio_start = True
        with self.assertRaisesRegex(backup.BackupError, "SERVICE_RESUME_UNCONFIRMED"):
            backup.run_backup(f.project, f.store)
        self.assertFalse(f.services["backend"]["State"]["Running"])
        self.assertTrue((f.store / "active.json").exists())
        self.assertFalse(any(call == ("start", f.services["backend"]["Id"]) for call in f.calls))
        f.fail_minio_start = False
        self.assertEqual(backup.recover(f.project, f.store)["status"], "ORIGINAL_SERVICES_RESUMED")
        f.assert_running(self)
        self.assertFalse((f.store / "active.json").exists())

    def test_lost_start_acknowledgement_reconciles_actual_health(self):
        self.fixture.lost_start_ack = True
        result = backup.run_backup(self.fixture.project, self.fixture.store)
        self.assertEqual(result["status"], "LOCAL_BACKUP_COMPLETE")

    def test_journal_write_error_during_finally_does_not_prevent_resume(self):
        f = self.fixture
        original = backup.save_state
        def fault(store, state):
            if state["phase"] == "RESUMING":
                raise OSError("synthetic disk full")
            original(store, state)
        with patch.object(backup, "save_state", side_effect=fault):
            self.assertEqual(backup.run_backup(f.project, f.store)["status"], "LOCAL_BACKUP_COMPLETE")
        f.assert_running(self)

    def test_busy_deploy_lock_does_not_stop_services(self):
        f = self.fixture
        with (f.project / ".deploy.lock").open("rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(backup.BackupError, "DEPLOY_OR_BACKUP_BUSY"):
                backup.run_backup(f.project, f.store)
        self.assertEqual(f.calls, [])

    def test_preflight_failure_does_not_stop_services(self):
        with patch.object(backup, "inventory", side_effect=backup.BackupError("INSUFFICIENT_DISK_SPACE")):
            with self.assertRaises(backup.BackupError):
                backup.run_backup(self.fixture.project, self.fixture.store)
        self.assertEqual(self.fixture.calls, [])

    def test_database_clients_abort_copy_and_resume_services(self):
        self.fixture.other_clients = 1
        with self.assertRaises(backup.BackupError):
            backup.run_backup(self.fixture.project, self.fixture.store)
        self.fixture.assert_running(self)
        self.assertFalse(list((self.fixture.store / "snapshots").iterdir()))

    def test_storage_symlink_is_not_archived(self):
        (self.fixture.storage / "unexpected-link").symlink_to(self.fixture.redis / "dump.rdb")
        with self.assertRaises(backup.BackupError):
            backup.run_backup(self.fixture.project, self.fixture.store)
        self.fixture.assert_running(self)

    def test_changed_container_identity_is_never_started_by_recovery(self):
        f = self.fixture
        f.fail_minio_start = True
        with self.assertRaises(backup.BackupError):
            backup.run_backup(f.project, f.store)
        f.services["minio"]["Id"] = "e" * 64
        f.calls.clear()
        with self.assertRaisesRegex(backup.BackupError, "ORIGINAL_CONTAINER_CHANGED"):
            backup.recover(f.project, f.store)
        self.assertFalse(any(call[0] == "start" for call in f.calls))

    def test_new_run_is_blocked_while_an_unreconciled_journal_exists(self):
        backup.write_json(self.fixture.store / "active.json", {})
        with self.assertRaisesRegex(backup.BackupError, "UNFINISHED_OPERATION"):
            backup.run_backup(self.fixture.project, self.fixture.store)
        self.assertEqual(self.fixture.calls, [])

    def test_hash_mismatch_preserves_all_old_checkpoints_before_pruning(self):
        f = self.fixture
        now = datetime.now(timezone.utc)
        points = [f.snapshot(now - timedelta(days=day)) for day in range(10)]
        (points[-1] / "database.dump").write_bytes(b"corrupt")
        with self.assertRaisesRegex(backup.BackupError, "SNAPSHOT_HASH_MISMATCH"):
            backup.prune(f.store, points[0].name)
        self.assertTrue(all(point.exists() for point in points))

    def test_retention_rejects_mixed_environments_before_deleting_any_points(self):
        f = self.fixture
        points = [f.snapshot(datetime.now(timezone.utc) - timedelta(days=day)) for day in range(10)]
        with self.assertRaisesRegex(backup.BackupError, "SNAPSHOT_ENVIRONMENT_MISMATCH"):
            backup.prune(f.store, points[0].name, "test")
        self.assertTrue(all(point.exists() for point in points))

    def test_retention_keeps_seven_distinct_days_and_last_successful_sunday(self):
        f = self.fixture
        # Failed Sunday + a gap: the protected Sunday may be older than all seven daily points.
        now = datetime(2026, 10, 19, 20, tzinfo=timezone.utc)
        days = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]
        points = [f.snapshot(now - timedelta(days=day)) for day in days
                  if (now - timedelta(days=day)).astimezone(backup.ALMATY).date().isoformat() != "2026-10-18"]
        manifests = [backup.verify_snapshot(point) for point in points]
        sunday = max((entry for entry in manifests if datetime.strptime(entry["date_almaty"], "%Y-%m-%d").weekday() == 6),
                     key=lambda entry: entry["completed_at_utc"])
        expected = backup.retention_keep(manifests)
        self.assertIn(sunday["name"], expected)
        self.assertEqual(len(expected), 8)
        self.assertEqual(backup.prune(f.store, points[0].name), 8)
        self.assertEqual({point.name for point in (f.store / "snapshots").iterdir()}, expected)

    def test_second_success_on_one_day_replaces_only_managed_same_day_copy(self):
        f = self.fixture
        now = datetime(2026, 10, 19, 10, tzinfo=timezone.utc)
        older, newer = f.snapshot(now), f.snapshot(now + timedelta(minutes=10))
        manual = f.root / "manual-backup.dump"
        manual.write_bytes(b"unmanaged backup")
        backup.prune(f.store, newer.name)
        self.assertFalse(older.exists())
        self.assertTrue(newer.exists())
        self.assertEqual(manual.read_bytes(), b"unmanaged backup")

    def test_snapshot_symlink_prevents_retention(self):
        f = self.fixture
        point = f.snapshot(datetime.now(timezone.utc))
        (f.store / "snapshots" / ("20261001T000000Z-" + "a" * 32)).symlink_to(point, target_is_directory=True)
        with self.assertRaises(backup.BackupError):
            backup.prune(f.store, point.name)
        self.assertTrue(point.exists())

    def test_partial_trash_cleanup_preserves_live_snapshots(self):
        f = self.fixture
        point = f.snapshot(datetime.now(timezone.utc))
        trash = f.store / ".trash" / point.name
        point.rename(trash)
        (trash / "database.dump").unlink()
        backup.clear_trash(trash)
        self.assertFalse(trash.exists())

    def test_trash_with_unknown_files_is_not_recursively_deleted(self):
        f = self.fixture
        point = f.snapshot(datetime.now(timezone.utc))
        trash = f.store / ".trash" / point.name
        point.rename(trash)
        (trash / "unrelated.txt").write_text("keep")
        with self.assertRaises(backup.BackupError):
            backup.clear_trash(trash)
        self.assertTrue((trash / "unrelated.txt").exists())

    def test_truncated_gzip_trailer_is_rejected(self):
        path = self.fixture.root / "truncated.tar.gz"
        self.fixture.config_tar(self.fixture.project, path)
        path.write_bytes(path.read_bytes()[:-5])
        with self.assertRaises((EOFError, OSError)):
            backup.verify_tar(path, data=False)

    def test_archive_path_traversal_is_rejected_without_extraction(self):
        path = self.fixture.root / "unsafe.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            item = tarfile.TarInfo("../../outside")
            item.size = 1
            archive.addfile(item, io.BytesIO(b"x"))
        with self.assertRaisesRegex(backup.BackupError, "UNSAFE_ARCHIVE_PATH"):
            backup.verify_tar(path)

    def test_installed_timer_has_no_daytime_catchup_and_checks_midnight_window(self):
        directory = Path(__file__).parents[1] / "backup"
        timer = (directory / "oxus-local-backup@.timer").read_text()
        service = (directory / "oxus-local-backup@.service").read_text()
        self.assertIn("OnCalendar=*-*-* 00:00:00 Asia/Almaty", timer)
        self.assertIn("Persistent=false", timer)
        self.assertIn("run --environment %i --scheduled", service)
        self.assertIn("recover --environment %i", service)
        self.assertIn("ReadWritePaths=/var/backups/oxus-backend/%i", service)
        self.assertIn("ExecStopPost=", service)
        with patch("sys.argv", ["oxus_backup.py", "run", "--scheduled"]), patch.object(backup, "datetime") as clock:
            clock.now.return_value = datetime(2026, 10, 19, 13, tzinfo=backup.ALMATY)
            with self.assertRaisesRegex(backup.BackupError, "OUTSIDE_MAINTENANCE_WINDOW"):
                backup.main()


if __name__ == "__main__":
    unittest.main()
