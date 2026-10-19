#!/usr/bin/env python3
"""Private local PostgreSQL/MinIO/Redis checkpoints for Test and Production."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
from urllib.parse import unquote, urlsplit
import uuid
from zoneinfo import ZoneInfo

PROJECT = Path("/opt/oxus_backend/deployment")
STORE = Path("/var/backups/oxus-backend")
PROJECT_NAME = "oxus_backend"
FORMAT = "oxus-local-backup/v1"
OWNER = 0
ALMATY = ZoneInfo("Asia/Almaty")
RUN_NAME = re.compile(r"\d{8}T\d{6}Z-[0-9a-f]{32}")
ARTIFACTS = {"database.dump", "database-globals.sql", "redis.rdb", "minio-data.tar.gz", "configuration.tar.gz"}
MAX_SOURCE = 10 * 1024**3
MAX_MEMBERS = 200_000


class BackupError(RuntimeError):
    """Only fixed diagnostic codes, never external command output."""


def command(*args, stdin=None, input_file=None, output=None, timeout=30):
    try:
        result = subprocess.run(args, input=stdin, stdin=input_file, stdout=output or subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as error:
        raise BackupError("COMMAND_INCOMPLETE") from error
    if result.returncode:
        raise BackupError("COMMAND_FAILED")
    return result.stdout


def docker(*args, **kwargs):
    return command("docker", "--host", "unix:///var/run/docker.sock", *args, **kwargs)


def private(path: Path, directory=False):
    info = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if not kind(info.st_mode) or info.st_uid != OWNER or info.st_mode & 0o077:
        raise BackupError("UNSAFE_BACKUP_PERMISSIONS")
    if not directory and info.st_nlink != 1:
        raise BackupError("LINKED_BACKUP_FILE")
    return info


def trusted_directory(path: Path):
    # Validate ancestors too: a writable parent can replace an otherwise safe target.
    for parent in (path, *path.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != OWNER or info.st_mode & 0o022:
            raise BackupError("UNTRUSTED_DIRECTORY")


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_json(path: Path, value):
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()


def read_json(path: Path):
    if private(path).st_size > 1024**2:
        raise BackupError("INVALID_RECEIPT")
    return json.loads(path.read_text())


def digest(path: Path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def new_file(path: Path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")


def environment(container):
    return dict(value.split("=", 1) for value in container["Config"].get("Env", []) if "=" in value)


def inspect(identity):
    return json.loads(docker("inspect", identity))[0]


def containers(all_containers=False, service=None):
    args = ["ps", "-q"]
    if all_containers:
        args.append("-a")
    args += ["--filter", "label=com.docker.compose.project=" + PROJECT_NAME]
    if service:
        args += ["--filter", "label=com.docker.compose.service=" + service]
    ids = docker(*args).decode().split()
    return json.loads(docker("inspect", *ids)) if ids else []


def healthy(item):
    return item["State"].get("Running") and item["State"].get("Health", {}).get("Status") == "healthy"


def volume(item, destination):
    mounts = [entry for entry in item.get("Mounts", []) if entry["Destination"] == destination]
    if len(mounts) != 1 or mounts[0].get("Type") != "volume":
        raise BackupError("EXPECTED_NAMED_VOLUME")
    if any(entry["Destination"].startswith(destination + "/") for entry in item.get("Mounts", [])):
        raise BackupError("NESTED_DATA_MOUNT")
    entry = json.loads(docker("volume", "inspect", mounts[0]["Name"]))[0]
    if entry.get("Driver") != "local" or entry.get("Scope") != "local" or entry.get("Options"):
        raise BackupError("UNSUPPORTED_VOLUME")
    path = Path(entry["Mountpoint"])
    trusted_directory(path.parent)
    if not stat.S_ISDIR(path.lstat().st_mode):
        raise BackupError("UNSAFE_VOLUME_PATH")
    return path


def source_files(path: Path):
    entries = []
    total = 0
    device = path.stat().st_dev
    for parent, directories, files in os.walk(path, followlinks=False):
        for name in sorted(directories + files):
            source = Path(parent) / name
            info = source.lstat()
            if info.st_dev != device or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise BackupError("UNSUPPORTED_STORAGE_ENTRY")
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
            entries.append(source)
            if total > MAX_SOURCE or len(entries) > MAX_MEMBERS:
                raise BackupError("BACKUP_SIZE_LIMIT")
    return entries, total


PG_ENV = ('unset PGSERVICE PGSERVICEFILE PGHOSTADDR PGPASSFILE; '
          'export PGPASSWORD="$POSTGRES_PASSWORD"; '
          'export PGAPPNAME=oxus-local-backup; '
          'export PGOPTIONS="-c default_transaction_read_only=on -c statement_timeout=90000 '
          '-c lock_timeout=5000 -c idle_in_transaction_session_timeout=90000"; ')
PG_CONNECT = '-w -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER"'


def sql(db, statement):
    return docker("exec", db, "sh", "-ec", PG_ENV + 'exec psql -X ' + PG_CONNECT +
                  ' -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "$1"',
                  "backup-readonly", statement, timeout=15).decode().strip()


def redis_command(identity, *args, timeout=15):
    return docker("exec", identity, "sh", "-ec",
                  'export REDISCLI_AUTH="$REDIS_PASSWORD"; exec redis-cli -e -h 127.0.0.1 -p 6379 --raw "$@"',
                  "backup-redis", *args, timeout=timeout).decode().strip()


def configuration_files(project):
    result = []
    for name in (".env", "compose.yaml", "compose.override.yaml", "deploy.sh", "jitsi-private-key.pk"):
        path = project / name
        if not path.exists() and name == "compose.override.yaml":
            continue
        info = path.lstat()
        # The backend runs as UID 1001 and mounts this existing private key read-only.
        application_key = (name == "jitsi-private-key.pk" and info.st_uid == 1001
                           and stat.S_IMODE(info.st_mode) == 0o400)
        if (not stat.S_ISREG(info.st_mode) or info.st_mode & 0o022
                or (info.st_uid != OWNER and not application_key)):
            raise BackupError("UNSAFE_PROJECT_CONFIGURATION")
        if name == ".env" and info.st_mode & 0o077:
            raise BackupError("UNSAFE_ENV_PERMISSIONS")
        result.append((path, "deployment/" + name))
    return result


def check_minio_command(arguments):
    if arguments[:2] != ["server", "/data"]:
        raise BackupError("UNSUPPORTED_MINIO_TOPOLOGY")
    tail = arguments[2:]
    if len(tail) % 2 or any(
        tail[index] not in ("--console-address", "--address")
        or not re.fullmatch(r":[0-9]{1,5}", tail[index + 1])
        for index in range(0, len(tail), 2)
    ):
        raise BackupError("UNSUPPORTED_MINIO_TOPOLOGY")


def check_minio_dependencies(item):
    # Dockerfile.release supplies these filenames even without mounted secrets.
    defaults = {"MINIO_ACCESS_KEY_FILE": "access_key", "MINIO_SECRET_KEY_FILE": "secret_key",
                "MINIO_ROOT_USER_FILE": "access_key", "MINIO_ROOT_PASSWORD_FILE": "secret_key",
                "MINIO_KMS_SECRET_KEY_FILE": "kms_master_key", "MINIO_CONFIG_ENV_FILE": "config.env"}
    filenames = set()
    for key, value in environment(item).items():
        if not value:
            continue
        if key in defaults:
            if value != defaults[key]:
                raise BackupError("EXTERNAL_MINIO_RECOVERY_DEPENDENCY")
            filenames.add(value)
        elif key == "MINIO_VOLUMES" or key.startswith(("MINIO_KMS_", "MINIO_IDENTITY_", "MINIO_ETCD_")):
            raise BackupError("EXTERNAL_MINIO_RECOVERY_DEPENDENCY")
    if filenames:
        # Check metadata only, including Docker secrets and the server's working directory.
        result = docker("exec", item["Id"], "sh", "-ec",
            'for name in "$@"; do '
            'for file in "$name" "/run/secrets/$name" "/proc/1/cwd/$name"; do '
            'if [ -e "$file" ] || [ -L "$file" ]; then printf PRESENT; exit 0; fi; '
            'done; done; printf ABSENT', "backup-file-dependencies", *sorted(filenames))
        if result != b"ABSENT":
            raise BackupError("EXTERNAL_MINIO_RECOVERY_DEPENDENCY")


def check_target(app, database, environment_name):
    expected_staging = {"production": "false", "test": "true"}.get(environment_name)
    if expected_staging is None:
        raise BackupError("UNKNOWN_ENVIRONMENT")
    target = urlsplit(app.get("DATABASE_URL", ""))
    if (app.get("STAGING", "").strip().lower() != expected_staging
            or target.scheme not in ("postgres", "postgresql") or target.hostname != "db"
            or target.port not in (None, 5432) or target.query or target.fragment
            or unquote(target.path[1:]) != database.get("POSTGRES_DB")
            or app.get("AWS_MINIO_ENDPOINT") != "http://minio:9000"
            or not database.get("POSTGRES_USER") or not database.get("POSTGRES_PASSWORD")):
        raise BackupError("ENVIRONMENT_TARGET_MISMATCH")


def inventory(project, store, environment_name="production"):
    if os.geteuid() != OWNER or sys.platform != "linux" or sys.version_info < (3, 11):
        raise BackupError("LOCAL_LINUX_ROOT_REQUIRED")
    if any(os.environ.get(key) for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")):
        raise BackupError("DOCKER_OVERRIDE_REJECTED")
    trusted_directory(project)
    configuration_files(project)
    items = containers(all_containers=True)
    services = {}
    for name in ("backend", "db", "minio", "redis"):
        matches = [item for item in items if item["Config"]["Labels"].get("com.docker.compose.service") == name]
        if len(matches) != 1 or not healthy(matches[0]):
            raise BackupError("EXPECTED_HEALTHY_SERVICES")
        services[name] = matches[0]
    if any(item["State"].get("Running") and item["Config"]["Labels"].get("com.docker.compose.service") == "migrator" for item in items):
        raise BackupError("MIGRATION_RUNNING")
    app, database = environment(services["backend"]), environment(services["db"])
    check_target(app, database, environment_name)
    allowed = {item["Id"] for item in services.values()}
    # Inspect all running containers, including workers in other Compose projects.
    ids = docker("ps", "-q").decode().split()
    running = json.loads(docker("inspect", *ids)) if ids else []
    for item in running:
        env = environment(item)
        if item["Id"] not in allowed and (
            env.get("DATABASE_URL") == app.get("DATABASE_URL")
            or env.get("AWS_MINIO_ENDPOINT") == app.get("AWS_MINIO_ENDPOINT")
            or env.get("REDIS_URL") == app.get("REDIS_URL") and app.get("REDIS_URL")
        ):
            raise BackupError("ADDITIONAL_WRITER_FOUND")
        source_mounts = services["minio"].get("Mounts", []) + services["redis"].get("Mounts", [])
        source_volumes = {mount["Name"] for mount in source_mounts if mount.get("Type") == "volume"}
        if item["Id"] not in allowed and any(
            mount.get("Name") in source_volumes and mount.get("RW", True) for mount in item.get("Mounts", [])
        ):
            raise BackupError("ADDITIONAL_VOLUME_WRITER_FOUND")
    details = json.loads(sql(services["db"]["Id"],
        "SELECT json_build_object('name',current_database(),'owner',pg_get_userbyid(datdba),"
        "'size_bytes',pg_database_size(current_database()),'version',current_setting('server_version_num')) "
        "FROM pg_database WHERE datname=current_database()"))
    if not 0 < details["size_bytes"] <= MAX_SOURCE:
        raise BackupError("BACKUP_SIZE_LIMIT")
    versions = [docker("exec", services["db"]["Id"], binary, "--version").decode() for binary in ("postgres", "pg_dump", "pg_restore")]
    majors = [re.search(r"PostgreSQL\) (\d+)", value) for value in versions]
    if not all(majors) or {int(value.group(1)) for value in majors} != {int(details["version"]) // 10000}:
        raise BackupError("POSTGRES_VERSION_MISMATCH")
    storage = volume(services["minio"], "/data")
    check_minio_command(services["minio"]["Config"].get("Cmd") or [])
    check_minio_dependencies(services["minio"])
    redis_data = volume(services["redis"], "/data")
    _, size = source_files(storage)
    config = redis_command(services["redis"]["Id"], "CONFIG", "GET", "dir", "dbfilename").splitlines()
    if len(config) != 4 or dict(zip(config[::2], config[1::2])) != {"dir": "/data", "dbfilename": "dump.rdb"}:
        raise BackupError("UNSUPPORTED_REDIS_PERSISTENCE_PATH")
    redis_size = int(redis_command(services["redis"]["Id"], "DBSIZE"))
    memory_info = redis_command(services["redis"]["Id"], "INFO", "memory")
    redis_memory = int(dict(line.split(":", 1) for line in memory_info.splitlines() if ":" in line)["used_memory"])
    # A large queue must be reviewed before adding synchronous SAVE to a maintenance window.
    if redis_size > 100_000 or redis_memory > 512 * 1024**2:
        raise BackupError("REDIS_KEY_LIMIT")
    target_directory = next(path for path in (store, *store.parents) if path.exists())
    trusted_directory(target_directory)
    reserve = max(1024**3, 3 * (details["size_bytes"] + size + redis_memory))
    if shutil.disk_usage(target_directory).free < reserve:
        raise BackupError("INSUFFICIENT_DISK_SPACE")
    return {"services": services, "database": details, "storage": storage, "storage_bytes": size,
            "redis_data": redis_data, "redis_keys": redis_size, "reserve_bytes": reserve}


def store_layout(store):
    private(store, directory=True)
    trusted_directory(store.parent)
    if (store / ".format").read_text() != FORMAT + "\n":
        raise BackupError("UNRECOGNIZED_BACKUP_STORE")
    private(store / ".format")
    for name in ("snapshots", ".partial", ".trash", "operations"):
        private(store / name, directory=True)


@contextmanager
def deploy_lock(project):
    path = project / ".deploy.lock"
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != OWNER or info.st_mode & 0o022 or info.st_nlink != 1:
        raise BackupError("UNSAFE_DEPLOY_LOCK")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if os.fstat(fd).st_ino != info.st_ino:
            raise BackupError("DEPLOY_LOCK_CHANGED")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise BackupError("DEPLOY_OR_BACKUP_BUSY") from error
        yield
    finally:
        os.close(fd)


def tar_configuration(project, target):
    sources = configuration_files(project)
    for name in ("nginx", "letsencrypt"):
        path = Path("/etc") / name
        if not path.exists():
            continue
        trusted_directory(path)
        sources.append((path, "host/" + name))
        for parent, directories, files in os.walk(path, followlinks=False):
            for child in sorted(directories + files):
                source = Path(parent) / child
                if not (source.is_symlink() or source.is_dir() or source.is_file()):
                    raise BackupError("UNSUPPORTED_HOST_CONFIGURATION_ENTRY")
                sources.append((source, "host/" + name + "/" + str(source.relative_to(path))))
                if len(sources) > MAX_MEMBERS:
                    raise BackupError("CONFIGURATION_SIZE_LIMIT")
    before = {path: path.lstat() for path, _ in sources}
    with new_file(target) as output, tarfile.open(fileobj=output, mode="w:gz", dereference=False) as archive:
        for path, name in sources:
            archive.add(path, arcname=name, recursive=False)
    for path, info in before.items():
        current = path.lstat()
        if (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (
                current.st_ino, current.st_size, current.st_mtime_ns, current.st_ctime_ns):
            raise BackupError("CONFIGURATION_CHANGED")


def safe_member(member, data=True):
    name = member.name
    if name.startswith("/") or ".." in Path(name).parts or not name:
        raise BackupError("UNSAFE_ARCHIVE_PATH")
    if data and (not (member.isdir() or member.isfile()) or member.mode & 0o7000):
        raise BackupError("UNSUPPORTED_ARCHIVE_ENTRY")
    if not data and not (member.isdir() or member.isfile() or member.issym() or member.islnk()):
        raise BackupError("UNSUPPORTED_ARCHIVE_ENTRY")


def verify_tar(path, data=True):
    seen = set()
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            safe_member(member, data)
            if member.name in seen or len(seen) >= MAX_MEMBERS:
                raise BackupError("DUPLICATE_OR_EXCESSIVE_ARCHIVE_ENTRIES")
            seen.add(member.name)
            if member.isfile():
                stream = archive.extractfile(member)
                while stream.read(1024**2):
                    pass
    # Read to EOF separately; tar EOF alone need not validate the gzip trailer.
    with gzip.open(path, "rb") as stream:
        while stream.read(1024**2):
            pass


def current_original(name, original):
    matches = containers(all_containers=True, service=name)
    if len(matches) != 1 or matches[0]["Id"] != original["id"] or matches[0]["Image"] != original["image"]:
        raise BackupError("ORIGINAL_CONTAINER_CHANGED")
    return matches[0]


def wait_healthy(name, original, timeout=90):
    deadline = time.monotonic() + timeout
    while True:
        item = current_original(name, original)
        if healthy(item):
            return
        if time.monotonic() >= deadline:
            raise BackupError("SERVICE_RESUME_UNCONFIRMED")
        time.sleep(2)


def save_state(store, state):
    write_json(store / "operations" / (state["name"] + ".json"), state)
    write_json(store / "active.json", state)


def resume(store, state):
    # Resume attempts must survive a second ordinary interrupt; systemd provides a final fallback.
    handlers = {number: signal.signal(number, signal.SIG_IGN) for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    try:
        if state.get("minio_stop_attempted"):
            item = current_original("minio", state["originals"]["minio"])
            if not item["State"].get("Running"):
                try:
                    docker("start", item["Id"], timeout=30)
                except BackupError:
                    pass  # Reconcile actual health after a possibly lost acknowledgement.
            wait_healthy("minio", state["originals"]["minio"])
        for name in ("db", "redis"):
            wait_healthy(name, state["originals"][name], timeout=15)
        if state.get("backend_stop_attempted"):
            item = current_original("backend", state["originals"]["backend"])
            if not item["State"].get("Running"):
                try:
                    docker("start", item["Id"], timeout=30)
                except BackupError:
                    pass
            wait_healthy("backend", state["originals"]["backend"])
            docker("exec", item["Id"], "curl", "--fail", "--silent", "--max-time", "5",
                   "http://localhost:4000/api/v1/health", timeout=10)
        state["services_resumed"] = True
        write_json(store / "operations" / (state["name"] + ".json"), state)
        (store / "active.json").unlink()
        sync_directory(store)
    finally:
        for number, handler in handlers.items():
            signal.signal(number, handler)


def verify_snapshot(path, environment_name=None):
    private(path, directory=True)
    if not RUN_NAME.fullmatch(path.name):
        raise BackupError("UNRECOGNIZED_SNAPSHOT")
    manifest = read_json(path / "manifest.json")
    if (manifest.get("format") != FORMAT or manifest.get("name") != path.name
            or manifest.get("complete") is not True or set(manifest.get("files", {})) != ARTIFACTS
            or manifest.get("environment") not in ("production", "test")
            or manifest.get("services_resumed") is not True):
        raise BackupError("INCOMPLETE_SNAPSHOT")
    if environment_name is not None and manifest["environment"] != environment_name:
        raise BackupError("SNAPSHOT_ENVIRONMENT_MISMATCH")
    if {item.name for item in path.iterdir()} != ARTIFACTS | {"manifest.json"}:
        raise BackupError("UNEXPECTED_SNAPSHOT_FILES")
    for name, expected in manifest["files"].items():
        item = path / name
        info = private(item)
        if info.st_size != expected["size_bytes"] or digest(item) != expected["sha256"]:
            raise BackupError("SNAPSHOT_HASH_MISMATCH")
    datetime.fromisoformat(manifest["completed_at_utc"])
    datetime.strptime(manifest["date_almaty"], "%Y-%m-%d")
    return manifest


def retention_keep(manifests):
    latest = {}
    ordered = sorted(manifests, key=lambda entry: entry["completed_at_utc"], reverse=True)
    for entry in ordered:
        latest.setdefault(entry["date_almaty"], entry["name"])
    keep = set(list(latest.values())[:7])
    sunday = next((entry for entry in ordered if datetime.strptime(entry["date_almaty"], "%Y-%m-%d").weekday() == 6), None)
    if sunday:
        keep.add(sunday["name"])
    return keep


def clear_trash(path, environment_name="production"):
    private(path, directory=True)
    if not RUN_NAME.fullmatch(path.name):
        raise BackupError("UNRECOGNIZED_TRASH")
    entries = {item.name for item in path.iterdir()}
    if not entries:
        path.rmdir()
        return
    manifest = read_json(path / "manifest.json")
    if (manifest.get("format") != FORMAT or manifest.get("name") != path.name
            or manifest.get("environment") != environment_name
            or manifest.get("complete") is not True or set(manifest.get("files", {})) != ARTIFACTS
            or not entries <= ARTIFACTS | {"manifest.json"}):
        raise BackupError("UNRECOGNIZED_TRASH")
    # A previous interrupted cleanup may already have removed some flat artifact files.
    for name in sorted(entries - {"manifest.json"}):
        item = path / name
        expected = manifest["files"][name]
        if private(item).st_size != expected["size_bytes"] or digest(item) != expected["sha256"]:
            raise BackupError("TRASH_CHANGED")
    for name in sorted(entries - {"manifest.json"}):
        (path / name).unlink()
    (path / "manifest.json").unlink()
    path.rmdir()


def prune(store, newest, environment_name="production"):
    # Validate the entire managed set before moving/deleting any prior checkpoint.
    manifests = [verify_snapshot(path, environment_name) for path in (store / "snapshots").iterdir()]
    keep = retention_keep(manifests)
    if newest not in keep:
        raise BackupError("NEW_CHECKPOINT_NOT_RETAINED")
    for entry in manifests:
        if entry["name"] not in keep:
            os.rename(store / "snapshots" / entry["name"], store / ".trash" / entry["name"])
    sync_directory(store / "snapshots")
    sync_directory(store / ".trash")
    for path in (store / ".trash").iterdir():
        clear_trash(path, environment_name)
    return len(keep)


def run_backup(project, store, environment_name="production"):
    store_layout(store)
    with deploy_lock(project):
        if (store / "active.json").exists():
            raise BackupError("UNFINISHED_OPERATION_REQUIRES_RECOVERY")
        plan = inventory(project, store, environment_name)
        now = datetime.now(timezone.utc)
        name = now.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex
        work = store / ".partial" / name
        work.mkdir(mode=0o700)
        state = {"format": FORMAT, "name": name, "environment": environment_name,
                 "phase": "CONFIGURATION", "services_resumed": False,
                 "backend_stop_attempted": False, "minio_stop_attempted": False,
                 "originals": {key: {"id": value["Id"], "image": value["Image"],
                                     "reference": value["Config"].get("Image", "UNKNOWN")}
                               for key, value in plan["services"].items()}}
        save_state(store, state)
        started = None
        failure = None
        try:
            tar_configuration(project, work / "configuration.tar.gz")
            started = time.monotonic()
            deadline = started + 120
            for service in ("backend", "minio"):
                state["phase"] = "STOP_" + service.upper()
                state[service + "_stop_attempted"] = True
                save_state(store, state)  # Persist intent before stopping a live service.
                item = current_original(service, state["originals"][service])
                docker("stop", "--time", "45", item["Id"], timeout=55)
                item = current_original(service, state["originals"][service])
                if item["State"].get("Running") or item["State"].get("OOMKilled") or item["State"].get("ExitCode") not in (0, 143):
                    raise BackupError("UNCLEAN_SERVICE_STOP")
            state["phase"] = "DATABASE"
            save_state(store, state)
            db = state["originals"]["db"]["id"]
            clients = int(sql(db, "SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid()"))
            if clients:
                raise BackupError("OTHER_DATABASE_CLIENTS_PRESENT")
            for filename, binary, options in (
                ("database.dump", "pg_dump", ' -d "$POSTGRES_DB" --format=custom --compress=1'),
                ("database-globals.sql", "pg_dumpall", " --roles-only"),
            ):
                remaining = int(deadline - time.monotonic())
                if remaining <= 0:
                    raise BackupError("MAINTENANCE_WINDOW_EXCEEDED")
                with new_file(work / filename) as output:
                    docker("exec", db, "sh", "-ec", PG_ENV + "exec " + binary + " " + PG_CONNECT + options,
                           output=output, timeout=min(90, remaining))
                    output.flush()
                    os.fsync(output.fileno())
            state["phase"] = "REDIS"
            save_state(store, state)
            if redis_command(state["originals"]["redis"]["id"], "SAVE", timeout=15) != "OK":
                raise BackupError("REDIS_SNAPSHOT_FAILED")
            docker("exec", state["originals"]["redis"]["id"], "redis-check-rdb", "/data/dump.rdb", timeout=15)
            source = plan["redis_data"] / "dump.rdb"
            before = source.lstat()
            if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE:
                raise BackupError("UNSUPPORTED_REDIS_SNAPSHOT")
            with source.open("rb") as input_file, new_file(work / "redis.rdb") as output:
                shutil.copyfileobj(input_file, output, length=1024**2)
                output.flush()
                os.fsync(output.fileno())
            after = source.lstat()
            if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                raise BackupError("REDIS_SNAPSHOT_CHANGED")
            if (work / "redis.rdb").stat().st_size != before.st_size:
                raise BackupError("REDIS_SNAPSHOT_INCOMPLETE")
            state["phase"] = "MINIO_FILES"
            save_state(store, state)
            entries, _ = source_files(plan["storage"])
            with new_file(work / "minio-data.tar") as output, tarfile.open(fileobj=output, mode="w", dereference=False) as archive:
                archive.add(plan["storage"], arcname="data", recursive=False)
                for source in entries:
                    if time.monotonic() >= deadline:
                        raise BackupError("MAINTENANCE_WINDOW_EXCEEDED")
                    archive.add(source, arcname="data/" + str(source.relative_to(plan["storage"])), recursive=False)
        except BaseException as error:
            failure = error
            state["failed_phase"] = state["phase"]
            state["failure_reason"] = str(error) if isinstance(error, BackupError) else "DIAGNOSTIC_WITHHELD"
        finally:
            state["phase"] = "RESUMING"
            try:
                save_state(store, state)
            except (OSError, BackupError):
                pass  # Disk/journal failures must not prevent service resumption.
            resume(store, state)
            state["maintenance_seconds"] = round(time.monotonic() - started, 3) if started else 0
            write_json(store / "operations" / (name + ".json"), state)
        if failure is not None:
            raise BackupError("BACKUP_FAILED_SERVICES_RESUMED") from failure
        # Compression, archive verification and retention run after API health has returned.
        state["phase"] = "VERIFYING"
        write_json(store / "operations" / (name + ".json"), state)
        with (work / "minio-data.tar").open("rb") as source, new_file(work / "minio-data.tar.gz") as output:
            with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=1, mtime=0) as compressed:
                shutil.copyfileobj(source, compressed, length=1024**2)
        (work / "minio-data.tar").unlink()
        verify_tar(work / "minio-data.tar.gz")
        verify_tar(work / "configuration.tar.gz", data=False)
        with (work / "database.dump").open("rb") as source:
            if source.read(5) != b"PGDMP":
                raise BackupError("INVALID_POSTGRES_ARCHIVE")
        with (work / "redis.rdb").open("rb") as source:
            if not re.fullmatch(rb"REDIS\d{4}", source.read(9)):
                raise BackupError("INVALID_REDIS_ARCHIVE")
        with (work / "database.dump").open("rb") as source:
            docker("exec", "-i", state["originals"]["db"]["id"], "pg_restore", "--list",
                   input_file=source, output=subprocess.DEVNULL, timeout=60)
        files = {}
        for filename in sorted(ARTIFACTS):
            path = work / filename
            info = private(path)
            if not info.st_size:
                raise BackupError("EMPTY_BACKUP_FILE")
            files[filename] = {"size_bytes": info.st_size, "sha256": digest(path)}
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
        completed = datetime.now(timezone.utc)
        manifest = {"format": FORMAT, "name": name, "environment": environment_name, "complete": True, "local_only": True,
                    "services_resumed": True, "started_at_utc": now.isoformat(), "completed_at_utc": completed.isoformat(),
                    "date_almaty": now.astimezone(ALMATY).date().isoformat(), "database": plan["database"],
                    "originals": state["originals"], "maintenance_seconds": state["maintenance_seconds"], "files": files,
                    "restore_exercised": False}
        write_json(work / "manifest.json", manifest)
        verify_snapshot(work, environment_name)
        os.rename(work, store / "snapshots" / name)
        sync_directory(store / "snapshots")
        write_json(store / "last-success.json", {"name": name, "environment": environment_name, "completed_at_utc": completed.isoformat(),
                                                  "maintenance_seconds": state["maintenance_seconds"], "local_only": True})
        state["phase"] = "COMPLETE"
        write_json(store / "operations" / (name + ".json"), state)
        retained = prune(store, name, environment_name)
        return {"status": "LOCAL_BACKUP_COMPLETE", "name": name, "environment": environment_name, "local_only": True,
                "maintenance_seconds": state["maintenance_seconds"], "retained_points": retained,
                "restore_exercised": False}


def recover(project, store, environment_name="production"):
    store_layout(store)
    with deploy_lock(project):
        if not (store / "active.json").exists():
            return {"status": "NO_RECOVERY_NEEDED"}
        state = read_json(store / "active.json")
        if state.get("format") != FORMAT or not RUN_NAME.fullmatch(state.get("name", "")):
            raise BackupError("INVALID_RECOVERY_JOURNAL")
        if state.get("environment") != environment_name:
            raise BackupError("RECOVERY_ENVIRONMENT_MISMATCH")
        for name in ("backend", "minio", "db", "redis"):
            original = state["originals"][name]
            if not re.fullmatch(r"[0-9a-f]{64}", original["id"]) or not re.fullmatch(r"sha256:[0-9a-f]{64}", original["image"]):
                raise BackupError("INVALID_RECOVERY_IDENTITY")
        resume(store, state)
        return {"status": "ORIGINAL_SERVICES_RESUMED", "backup_complete": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("preflight", "run", "recover", "status", "verify"))
    parser.add_argument("--environment", choices=("production", "test"), default="production")
    parser.add_argument("--scheduled", action="store_true", help="Refuse maintenance outside 00:00–00:14 Almaty")
    args = parser.parse_args()
    os.umask(0o077)
    store = STORE / args.environment
    if args.scheduled:
        now = datetime.now(ALMATY)
        if args.action != "run" or now.hour != 0 or now.minute >= 15:
            raise BackupError("OUTSIDE_MAINTENANCE_WINDOW")
    if args.action == "preflight":
        result = inventory(PROJECT, store, args.environment)
        print(json.dumps({"status": "PREFLIGHT_PASS", "environment": args.environment, "server_writes": False,
                          "database_bytes": result["database"]["size_bytes"], "minio_bytes": result["storage_bytes"],
                          "redis_keys": result["redis_keys"], "required_free_bytes": result["reserve_bytes"]}))
    elif args.action == "run":
        print(json.dumps(run_backup(PROJECT, store, args.environment)))
    elif args.action == "recover":
        print(json.dumps(recover(PROJECT, store, args.environment)))
    else:
        store_layout(store)
        latest = read_json(store / "last-success.json") if (store / "last-success.json").exists() else None
        if latest and latest.get("environment") != args.environment:
            raise BackupError("SNAPSHOT_ENVIRONMENT_MISMATCH")
        if args.action == "verify":
            if not latest or not RUN_NAME.fullmatch(latest.get("name", "")):
                raise BackupError("NO_COMPLETED_BACKUP")
            path = store / "snapshots" / latest["name"]
            verify_snapshot(path, args.environment)
            verify_tar(path / "minio-data.tar.gz")
            verify_tar(path / "configuration.tar.gz", data=False)
            print(json.dumps({"status": "LATEST_BACKUP_INTEGRITY_VERIFIED", "environment": args.environment,
                              "restore_exercised": False}))
        else:
            print(json.dumps({"environment": args.environment, "last_success": latest,
                              "recovery_required": (store / "active.json").exists(),
                              "incomplete_points": len(list((store / ".partial").iterdir())), "local_only": True}))


def interrupted(number, frame):
    raise BackupError("INTERRUPTED")


if __name__ == "__main__":
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        main()
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({"status": "FAILED", "reason": str(error) if isinstance(error, BackupError) else "DIAGNOSTIC_WITHHELD",
                          "action": "Check journal and backup status; do not restore over a running environment."}), file=sys.stderr)
        raise SystemExit(1)
