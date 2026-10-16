import io
from pathlib import Path

from config import get_settings


class PrivateObjectStorage:
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        raise NotImplementedError

    def get_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError


class LocalPrivateObjectStorage(PrivateObjectStorage):
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError("Invalid storage key")
        return path

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        del content_type
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get_bytes(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()


class S3PrivateObjectStorage(PrivateObjectStorage):
    def __init__(self, *, bucket: str, endpoint: str | None = None, region: str | None = None):
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint or None, region_name=region or None)

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self.client.upload_fileobj(
            io.BytesIO(data), self.bucket, key,
            ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"},
        )

    def get_bytes(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def get_private_storage(namespace: str) -> PrivateObjectStorage:
    safe_namespace = "".join(ch for ch in namespace.lower() if ch.isalnum() or ch in {"-", "_"})
    if not safe_namespace:
        raise ValueError("Storage namespace is required")
    settings = get_settings()
    if settings.private_storage_backend == "s3":
        if not settings.private_s3_bucket:
            raise RuntimeError("PRIVATE_S3_BUCKET is required for S3 storage")
        return S3PrivateObjectStorage(
            bucket=settings.private_s3_bucket,
            endpoint=settings.private_s3_endpoint,
            region=settings.private_s3_region,
        )
    root = Path(settings.private_storage_path) if settings.private_storage_path else Path(__file__).resolve().parents[1] / "uploads" / "private"
    return LocalPrivateObjectStorage(root / safe_namespace)

