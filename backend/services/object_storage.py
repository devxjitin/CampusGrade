import asyncio
import io
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

from config import get_settings


class PrivateObjectStorage:
    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        raise NotImplementedError

    def get_bytes(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def size(self, key: str) -> int | None:
        """Object size in bytes, or None when it does not exist."""
        raise NotImplementedError

    def presign_get(self, key: str, *, filename: str, content_type: str, expires: int = 300) -> str | None:
        """Browser-usable download URL, or None when this backend cannot hand one out."""
        return None

    def presign_put(self, key: str, *, content_type: str, expires: int = 900) -> str | None:
        """Browser-usable upload URL, or None when this backend cannot hand one out."""
        return None

    # The sync methods block on disk/network I/O; async routes use these so the
    # event loop keeps serving other requests.
    async def aput_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        await asyncio.to_thread(self.put_bytes, key, data, content_type)

    async def aget_bytes(self, key: str) -> bytes:
        return await asyncio.to_thread(self.get_bytes, key)

    async def adelete(self, key: str) -> None:
        await asyncio.to_thread(self.delete, key)

    async def asize(self, key: str) -> int | None:
        return await asyncio.to_thread(self.size, key)


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

    def size(self, key: str) -> int | None:
        path = self._path(key)
        return path.stat().st_size if path.exists() else None


class S3PrivateObjectStorage(PrivateObjectStorage):
    def __init__(
        self,
        *,
        bucket: str,
        endpoint: str | None = None,
        region: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
        sse: str | None = "AES256",
        public_endpoint: str | None = None,
    ):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.sse = sse or None
        options: dict = {"endpoint_url": endpoint or None, "region_name": region or None}
        if access_key and secret_key:
            options.update(aws_access_key_id=access_key, aws_secret_access_key=secret_key)
        # Path-style addressing is required by MinIO and works on AWS S3 too.
        config = Config(s3={"addressing_style": "path"}, signature_version="s3v4")
        self.client = boto3.client("s3", config=config, **options)
        # Presigned URLs must be signed for the host the browser will call. The
        # public endpoint may carry a path prefix (https://host/storage) that the
        # reverse proxy strips, so sign for the bare origin and re-insert the
        # prefix afterwards: the signature then matches what the store receives.
        self._public_prefix = ""
        self._signer = None
        if public_endpoint:
            parts = urlsplit(public_endpoint)
            self._public_prefix = parts.path.rstrip("/")
            origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
            self._signer = boto3.client("s3", config=config, **{**options, "endpoint_url": origin})

    def _presign(self, method: str, params: dict, expires: int) -> str | None:
        if self._signer is None:
            return None
        url = self._signer.generate_presigned_url(method, Params={"Bucket": self.bucket, **params}, ExpiresIn=expires)
        if not self._public_prefix:
            return url
        parts = urlsplit(url)
        return urlunsplit((parts.scheme, parts.netloc, self._public_prefix + parts.path, parts.query, ""))

    def presign_get(self, key: str, *, filename: str, content_type: str, expires: int = 300) -> str | None:
        safe_name = filename.replace('"', "")
        disposition = f"attachment; filename*=UTF-8''{quote(safe_name, safe='')}"
        return self._presign(
            "get_object",
            {"Key": key, "ResponseContentDisposition": disposition, "ResponseContentType": content_type},
            expires,
        )

    def presign_put(self, key: str, *, content_type: str, expires: int = 900) -> str | None:
        params = {"Key": key, "ContentType": content_type}
        if self.sse:
            params["ServerSideEncryption"] = self.sse
        return self._presign("put_object", params, expires)

    def size(self, key: str) -> int | None:
        from botocore.exceptions import ClientError

        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return None
            raise

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        extra_args = {"ContentType": content_type}
        if self.sse:
            extra_args["ServerSideEncryption"] = self.sse
        self.client.upload_fileobj(io.BytesIO(data), self.bucket, key, ExtraArgs=extra_args)

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
            access_key=settings.private_s3_access_key,
            secret_key=settings.private_s3_secret_key,
            sse=settings.private_s3_sse,
            public_endpoint=settings.private_s3_public_endpoint,
        )
    root = Path(settings.private_storage_path) if settings.private_storage_path else Path(__file__).resolve().parents[1] / "uploads" / "private"
    return LocalPrivateObjectStorage(root / safe_namespace)

