"""Opt-in real restore of synthetic data on cached Docker Desktop images only."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import uuid

SPEC = importlib.util.spec_from_file_location("oxus_backup_integration", Path(__file__).parents[1] / "backup/oxus_backup.py")
backup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup)
LABEL = "org.oxus.local-backup-fixture"


@unittest.skipUnless(os.environ.get("OXUS_BACKUP_INTEGRATION") == "1" and sys.platform == "darwin",
                     "Opt-in Docker Desktop fixture; never run against a Linux Production host")
class RealRestoreTests(unittest.TestCase):
    def test_postgres16_roles_data_owner_acl_and_redis8_rdb_round_trip(self):
        self.assertEqual(backup.command("docker", "context", "show").decode().strip(), "desktop-linux")
        operation = uuid.uuid4().hex
        owned = []
        with tempfile.TemporaryDirectory(prefix="oxus-backup-fixture-") as directory:
            root = Path(directory)
            def create(kind, image, *args, command=()):
                name = "oxus-backup-fixture-" + operation[:12] + "-" + kind
                identity = backup.docker("create", "--pull=never", "--name", name,
                    "--label", LABEL + "=" + operation, "--network", "none", "--restart", "no",
                    "--memory", "512m", "--memory-swap", "512m", "--cpus", "1", "--pids-limit", "128",
                    *args, image, *command).decode().strip()
                owned.append(identity)
                return identity
            def ready(identity, command):
                deadline = time.monotonic() + 60
                while time.monotonic() < deadline:
                    try:
                        backup.docker("exec", identity, *command)
                        return
                    except backup.BackupError:
                        time.sleep(1)
                self.fail("Synthetic fixture did not become ready")
            def psql(identity, user, database, sql):
                return backup.docker("exec", "-i", identity, "psql", "-X", "-U", user, "-d", database,
                                     "-v", "ON_ERROR_STOP=1", "-At", stdin=sql.encode()).decode().strip()
            try:
                source = create("pg-source", "postgres:16.0", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
                                "-e", "POSTGRES_USER=fixture_owner", "-e", "POSTGRES_DB=fixture_db")
                target = create("pg-restored", "postgres:16.0", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
                                "-e", "POSTGRES_USER=fixture_recovery_admin", "-e", "POSTGRES_DB=recovery_admin")
                redis_start = ("sh", "-ec", 'exec redis-server --requirepass "$REDIS_PASSWORD"')
                redis_source = create("redis-source", "redis:8-alpine", "-e", "REDIS_PASSWORD=synthetic-fixture-password", command=redis_start)
                redis_target = create("redis-restored", "redis:8-alpine", "-e", "REDIS_PASSWORD=synthetic-fixture-password", command=redis_start)
                for identity in (source, target):
                    backup.docker("start", identity)
                ready(source, ["pg_isready", "-U", "fixture_owner", "-d", "fixture_db"])
                ready(target, ["pg_isready", "-U", "fixture_recovery_admin", "-d", "recovery_admin"])
                psql(source, "fixture_owner", "fixture_db", "CREATE ROLE fixture_reader NOLOGIN; "
                     "CREATE TABLE documents (id integer PRIMARY KEY, file_key text NOT NULL); "
                     "INSERT INTO documents SELECT n, 'synthetic/' || n FROM generate_series(1, 25) n; "
                     "GRANT SELECT ON documents TO fixture_reader;")
                query = "SELECT json_build_object('rows',(SELECT count(*) FROM documents), "
                query += "'owner',(SELECT tableowner FROM pg_tables WHERE tablename='documents'), "
                query += "'reader',has_table_privilege('fixture_reader','documents','SELECT'));"
                expected = json.loads(psql(source, "fixture_owner", "fixture_db", query))
                for filename, binary, options in (
                    ("database.dump", "pg_dump", ' -d "$POSTGRES_DB" --format=custom --compress=1'),
                    ("database-globals.sql", "pg_dumpall", " --roles-only"),
                ):
                    with backup.new_file(root / filename) as output:
                        backup.docker("exec", source, "sh", "-ec", backup.PG_ENV + "exec " + binary + " " + backup.PG_CONNECT + options,
                                      output=output, timeout=60)
                psql(target, "fixture_recovery_admin", "recovery_admin", (root / "database-globals.sql").read_text())
                backup.docker("exec", target, "createdb", "-U", "fixture_recovery_admin", "--owner=fixture_owner", "fixture_db")
                with (root / "database.dump").open("rb") as stream:
                    backup.docker("exec", "-i", target, "pg_restore", "-U", "fixture_recovery_admin", "-d", "fixture_db",
                                  "--single-transaction", "--exit-on-error", input_file=stream, timeout=60)
                self.assertEqual(json.loads(psql(target, "fixture_recovery_admin", "fixture_db", query)), expected)
                self.assertEqual(json.loads(psql(source, "fixture_owner", "fixture_db", query)), expected)

                backup.docker("start", redis_source)
                ready(redis_source, ["redis-cli", "ping"])
                self.assertEqual(backup.redis_command(redis_source, "SET", "fixture:queue", "synthetic-pending-job"), "OK")
                self.assertEqual(backup.redis_command(redis_source, "SAVE"), "OK")
                backup.docker("exec", redis_source, "redis-check-rdb", "/data/dump.rdb")
                archive_bytes = backup.docker("cp", redis_source + ":/data/dump.rdb", "-")
                with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
                    rdb = archive.extractfile("dump.rdb").read()
                (root / "redis.rdb").write_bytes(rdb)
                backup.docker("cp", str(root / "redis.rdb"), redis_target + ":/data/dump.rdb")
                backup.docker("start", redis_target)
                ready(redis_target, ["redis-cli", "ping"])
                self.assertEqual(backup.redis_command(redis_target, "GET", "fixture:queue"), "synthetic-pending-job")
                self.assertEqual(backup.redis_command(redis_source, "GET", "fixture:queue"), "synthetic-pending-job")
            finally:
                for identity in reversed(owned):
                    item = backup.inspect(identity)
                    self.assertEqual(item["Config"]["Labels"].get(LABEL), operation)
                    self.assertEqual(item["HostConfig"]["NetworkMode"], "none")
                    # Remove only these freshly created fixtures and their anonymous volumes.
                    backup.docker("rm", "--force", "--volumes", identity, timeout=45)


if __name__ == "__main__":
    unittest.main()
