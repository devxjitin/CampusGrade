import asyncio
from urllib.parse import parse_qs, urlsplit

from services.object_storage import LocalPrivateObjectStorage, S3PrivateObjectStorage


def _s3(public_endpoint):
    return S3PrivateObjectStorage(
        bucket="b",
        endpoint="http://storage:9000",
        region="us-east-1",
        access_key="ak",
        secret_key="sk",
        sse=None,
        public_endpoint=public_endpoint,
    )


def test_presigned_get_uses_public_host_and_prefix_with_signature_for_bare_origin():
    url = _s3("https://campusgrade.localhost/storage").presign_get("attachments/a/b/f.pdf", filename="f.pdf", content_type="application/pdf")
    parts = urlsplit(url)
    assert (parts.scheme, parts.netloc) == ("https", "campusgrade.localhost")
    assert parts.path == "/storage/b/attachments/a/b/f.pdf"
    query = parse_qs(parts.query)
    assert query["X-Amz-Expires"] == ["300"]
    assert "X-Amz-Signature" in query
    assert "attachment" in query["response-content-disposition"][0]


def test_presigned_put_signs_content_type():
    url = _s3("https://campusgrade.localhost/storage").presign_put("k", content_type="application/pdf")
    assert "content-type" in parse_qs(urlsplit(url).query)["X-Amz-SignedHeaders"][0]


def test_no_public_endpoint_means_no_presign():
    assert _s3(None).presign_get("k", filename="f", content_type="text/plain") is None


def test_local_storage_has_async_helpers_and_no_presign(tmp_path):
    storage = LocalPrivateObjectStorage(tmp_path)
    assert storage.presign_get("k", filename="f", content_type="text/plain") is None

    async def run():
        await storage.aput_bytes("x/y", b"hello")
        assert await storage.asize("x/y") == 5
        assert await storage.aget_bytes("x/y") == b"hello"
        await storage.adelete("x/y")
        assert await storage.asize("x/y") is None

    asyncio.run(run())
