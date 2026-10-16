"""Copy legacy private artifacts into the configured namespaced storage.

Dry-run is the default. Pass --apply only after reviewing the reported keys.
Sources are never deleted by this utility.
"""

import argparse
import hashlib
import mimetypes
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.object_storage import get_private_storage  # noqa: E402


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", required=True, choices=["assignments"])
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    default_root = Path(__file__).resolve().parents[1] / "uploads" / args.namespace
    source_root = (args.source_root or default_root).resolve()
    if not source_root.is_dir():
        parser.error(f"Source directory does not exist: {source_root}")

    target = get_private_storage(args.namespace)
    copied = unchanged = failed = 0
    files = sorted(path for path in source_root.rglob("*") if path.is_file())
    for path in files:
        key = path.relative_to(source_root).as_posix()
        source_data = path.read_bytes()
        try:
            target_data = target.get_bytes(key)
        except (FileNotFoundError, KeyError):
            target_data = None
        if target_data is not None and digest(target_data) == digest(source_data):
            unchanged += 1
            print(f"UNCHANGED {key}")
            continue
        if not args.apply:
            print(f"WOULD_COPY {key} bytes={len(source_data)} sha256={digest(source_data)}")
            copied += 1
            continue
        try:
            target.put_bytes(key, source_data, mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            if digest(target.get_bytes(key)) != digest(source_data):
                raise RuntimeError("target digest did not match")
            copied += 1
            print(f"COPIED {key}")
        except Exception as exc:
            failed += 1
            print(f"FAILED {key}: {exc}", file=sys.stderr)
    print({"mode": "apply" if args.apply else "dry-run", "files": len(files), "copied": copied, "unchanged": unchanged, "failed": failed})
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
