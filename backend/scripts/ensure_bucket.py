"""Create the private object-storage bucket if it does not exist yet.

Run once per deployment by the one-shot `storage-init` container, before the API
starts. Uses the same boto3 client and settings as the application, so it works
against any S3-compatible store (RustFS/Garage/SeaweedFS locally, AWS S3 later)
without depending on a vendor admin tool. Safe to run repeatedly.

    python -m scripts.ensure_bucket
"""

from __future__ import annotations

import sys
import time

from botocore.exceptions import ClientError, EndpointConnectionError
from config import get_settings
from services.object_storage import S3PrivateObjectStorage

ATTEMPTS = 30
DELAY_SECONDS = 2


def main() -> int:
    settings = get_settings()
    if settings.private_storage_backend != "s3" or not settings.private_s3_bucket:
        print("PRIVATE_STORAGE_BACKEND is not s3; nothing to do.")
        return 0

    storage = S3PrivateObjectStorage(
        bucket=settings.private_s3_bucket,
        endpoint=settings.private_s3_endpoint,
        region=settings.private_s3_region,
        access_key=settings.private_s3_access_key,
        secret_key=settings.private_s3_secret_key,
        sse=settings.private_s3_sse,
    )
    client = storage.client
    bucket = settings.private_s3_bucket

    for attempt in range(1, ATTEMPTS + 1):
        try:
            try:
                client.head_bucket(Bucket=bucket)
                print(f"Bucket '{bucket}' already exists.")
            except ClientError as exc:
                if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket", "NotFound"}:
                    raise
                client.create_bucket(Bucket=bucket)
                print(f"Created bucket '{bucket}'.")
            # A bucket must never be publicly readable; presigned URLs are the only way in.
            try:
                client.put_public_access_block(
                    Bucket=bucket,
                    PublicAccessBlockConfiguration={
                        "BlockPublicAcls": True,
                        "IgnorePublicAcls": True,
                        "BlockPublicPolicy": True,
                        "RestrictPublicBuckets": True,
                    },
                )
            except ClientError:
                # Not every S3-compatible store implements this API; the bucket is
                # private by default and no anonymous policy is ever attached.
                pass
            return 0
        except (EndpointConnectionError, ClientError) as exc:
            print(f"Storage not ready yet (attempt {attempt}/{ATTEMPTS}): {exc}", file=sys.stderr)
            time.sleep(DELAY_SECONDS)
    print("Object storage never became ready.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
