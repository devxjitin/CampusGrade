"""CampusGrade backups: a PostgreSQL dump plus a copy of the object-storage bucket.

    backup.py schedule                       nightly loop (the `backup` service)
    backup.py once                           take one backup now
    backup.py restore --from DIR [--db NAME] [--skip-files]

Each backup is a directory <BACKUP_DIR>/<UTC timestamp>/ holding db.dump
(pg_dump custom format), files/ (bucket mirror) and manifest.json. A backup is
built in a ".partial" directory and renamed when complete, so a crash never
leaves something that looks valid. Files unchanged since the previous backup are
hard-linked (copied where links are unsupported), so a nightly run costs little.

Retention: the newest KEEP_DAILY (14) backups plus the newest backup of each of
the last KEEP_WEEKLY (8) ISO weeks.

Restore without --db replaces the live database and bucket contents; stop the
api/worker first (scripts/restore.ps1 does). With --db NAME it restores only the
database, into a new scratch database, and touches nothing else.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise SystemExit(f"{name} is required")
    return value


def secret(name: str) -> str:
    return Path(f"/run/secrets/{name}").read_text(encoding="utf-8").strip()


def pg_env() -> dict[str, str]:
    return {
        **os.environ,
        "PGHOST": env("PGHOST", "postgres"),
        "PGUSER": env("PGUSER", "campusgrade"),
        "PGPASSWORD": secret("postgres_password"),
    }


def s3_client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=env("PRIVATE_S3_ENDPOINT", "http://storage:9000"),
        region_name=env("PRIVATE_S3_REGION", "us-east-1"),
        aws_access_key_id=env("PRIVATE_S3_ACCESS_KEY"),
        aws_secret_access_key=secret("private_s3_secret_key"),
        config=Config(s3={"addressing_style": "path"}, signature_version="s3v4"),
    )


def bucket() -> str:
    return env("PRIVATE_S3_BUCKET", "campusgrade-private")


def backup_root() -> Path:
    root = Path(env("BACKUP_DIR", "/backups"))
    root.mkdir(parents=True, exist_ok=True)
    return root


def list_objects(client):
    token = None
    while True:
        kwargs = {"Bucket": bucket()}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        yield from page.get("Contents", [])
        if not page.get("IsTruncated"):
            return
        token = page["NextContinuationToken"]


def complete_backups(root: Path) -> list[Path]:
    return sorted(p for p in root.iterdir() if p.is_dir() and not p.name.endswith(".partial") and (p / "manifest.json").exists())


def take_backup() -> Path:
    root = backup_root()
    previous = complete_backups(root)
    previous_dir = previous[-1] if previous else None
    previous_files = json.loads((previous_dir / "manifest.json").read_text())["files"] if previous_dir else {}

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    work = root / f"{stamp}.partial"
    if work.exists():
        shutil.rmtree(work)
    (work / "files").mkdir(parents=True)
    try:
        db = env("PGDATABASE", "campusgrade_db")
        subprocess.run(["pg_dump", "-Fc", "--no-owner", "-d", db, "-f", str(work / "db.dump")], check=True, env=pg_env())

        client = s3_client()
        files: dict[str, str] = {}
        for obj in list_objects(client):
            key, etag = obj["Key"], obj["ETag"]
            dest = work / "files" / key
            dest.parent.mkdir(parents=True, exist_ok=True)
            old = previous_dir / "files" / key if previous_dir else None
            if old and previous_files.get(key) == etag and old.exists():
                try:
                    os.link(old, dest)
                except OSError:
                    shutil.copy2(old, dest)
            else:
                client.download_file(bucket(), key, str(dest))
            files[key] = etag
        (work / "manifest.json").write_text(
            json.dumps({"created_at": stamp, "database": db, "bucket": bucket(), "files": files}, indent=1), encoding="utf-8"
        )
    except BaseException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    final = root / stamp
    work.rename(final)
    prune(root)
    print(f"Backup complete: {final} ({len(files)} files)", flush=True)
    return final


def prune(root: Path) -> None:
    keep_daily = int(env("KEEP_DAILY", "14"))
    keep_weekly = int(env("KEEP_WEEKLY", "8"))
    backups = complete_backups(root)
    keep = set(backups[-keep_daily:])
    weeks: dict[tuple[int, int], Path] = {}
    for path in backups:  # ascending, so the last one per week wins
        iso = dt.datetime.strptime(path.name, "%Y%m%d-%H%M%S").isocalendar()
        weeks[(iso[0], iso[1])] = path
    keep.update(weeks[k] for k in sorted(weeks)[-keep_weekly:])
    for path in backups:
        if path not in keep:
            shutil.rmtree(path, ignore_errors=True)
            print(f"Pruned {path.name}", flush=True)
    for stale in root.glob("*.partial"):
        shutil.rmtree(stale, ignore_errors=True)


def restore(source: Path, scratch_db: str | None, skip_files: bool) -> None:
    manifest = json.loads((source / "manifest.json").read_text())
    target = scratch_db or manifest["database"]
    penv = pg_env()
    admin = ["psql", "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c"]
    subprocess.run([*admin, f'DROP DATABASE IF EXISTS "{target}" WITH (FORCE)'], check=True, env=penv)
    subprocess.run([*admin, f'CREATE DATABASE "{target}"'], check=True, env=penv)
    subprocess.run(["pg_restore", "--no-owner", "-d", target, str(source / "db.dump")], check=True, env=penv)
    print(f"Database restored into '{target}'.", flush=True)
    if scratch_db or skip_files:
        return
    client = s3_client()
    wanted = set(manifest["files"])
    for key in wanted:
        client.upload_file(str(source / "files" / key), bucket(), key)
    for obj in list(list_objects(client)):
        if obj["Key"] not in wanted:
            client.delete_object(Bucket=bucket(), Key=obj["Key"])
    print(f"Bucket restored ({len(wanted)} files).", flush=True)


def schedule() -> None:
    hour = int(env("BACKUP_HOUR", "2"))
    while True:
        now = dt.datetime.now()
        nxt = now.replace(hour=hour, minute=0, second=0, microsecond=0)
        if nxt <= now:
            nxt += dt.timedelta(days=1)
        print(f"Next backup at {nxt:%Y-%m-%d %H:%M}", flush=True)
        time.sleep((nxt - now).total_seconds())
        try:
            take_backup()
        except Exception as exc:  # keep the loop alive; the next night retries
            print(f"Backup FAILED: {exc}", file=sys.stderr, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("schedule")
    sub.add_parser("once")
    r = sub.add_parser("restore")
    r.add_argument("--from", dest="source", required=True)
    r.add_argument("--db")
    r.add_argument("--skip-files", action="store_true")
    args = parser.parse_args()
    if args.command == "schedule":
        schedule()
    elif args.command == "once":
        take_backup()
    else:
        source = Path(args.source)
        if not source.is_absolute():
            source = backup_root() / source
        restore(source, args.db, args.skip_files)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
