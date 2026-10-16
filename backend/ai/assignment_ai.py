"""Document extraction and Azure OpenAI helpers used by assignment workflows."""

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from io import BytesIO
from typing import Any
from urllib.parse import quote, urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from config import get_settings

logger = logging.getLogger("CampusGrade.AssignmentAI")


def _safe_text(value: Any, max_length: int = 2000) -> str:
    if value is None:
        return ""
    return str(value).replace("\x00", "").strip()[:max_length]


def _normalize_multiline_text(value: str, max_length: int = 100000) -> str:
    if not value:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)[:max_length]


def extract_text_from_document(filename: str, content_bytes: bytes) -> tuple[str, str | None]:
    if not isinstance(content_bytes, (bytes, bytearray)):
        return "", "Invalid file payload"
    raw = bytes(content_bytes)
    if not raw:
        return "", "Uploaded file is empty"
    extension = os.path.splitext(_safe_text(filename, 260).lower())[1]
    try:
        if extension == ".pdf":
            from pypdf import PdfReader

            text = _normalize_multiline_text(
                "\n\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(raw)).pages),
                max_length=90000,
            )
        elif extension == ".docx":
            import docx

            document = docx.Document(BytesIO(raw))
            text = _normalize_multiline_text(
                "\n".join(paragraph.text for paragraph in document.paragraphs),
                max_length=90000,
            )
        else:
            text = _normalize_multiline_text(raw.decode("utf-8", errors="ignore"), max_length=90000)
        return (text, None) if text else ("", f"No extractable text found in {extension.lstrip('.').upper() or 'document'}")
    except Exception as exc:
        logger.error("Document text extraction failed: %s", exc)
        return "", "Failed to extract text from uploaded document"


@dataclass(frozen=True)
class AzureOpenAIConfig:
    endpoint: str
    api_key: str
    deployment: str
    api_version: str


def _normalise_azure_endpoint(value: str) -> str | None:
    """Return the Azure resource endpoint without API path fragments."""
    endpoint = value.strip().rstrip("/")
    if "/openai/" in endpoint:
        endpoint = endpoint.split("/openai/", 1)[0]
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        return None
    return f"https://{parsed.netloc}{parsed.path.rstrip('/')}"


def _azure_openai_config() -> AzureOpenAIConfig | None:
    """Load Azure OpenAI's deployment-based REST configuration.

    ``AZURE_OPENAI_BASE_URL`` and ``AZURE_OPENAI_MODEL`` remain supported as
    migration aliases. Azure model deployments are addressed by deployment
    name, not by the provider model identifier.
    """
    settings = get_settings()
    configured_endpoint = (settings.azure_openai_endpoint or "").strip()
    endpoint = _normalise_azure_endpoint(configured_endpoint or (settings.azure_openai_base_url or ""))
    api_key = (settings.azure_openai_api_key or "").strip()
    deployment = (settings.azure_openai_deployment or "").strip() or (settings.azure_openai_model or "").strip()
    api_version = (settings.azure_openai_api_version or "2024-10-21").strip() or "2024-10-21"
    if not endpoint or not api_key or not deployment:
        return None
    return AzureOpenAIConfig(endpoint=endpoint, api_key=api_key, deployment=deployment, api_version=api_version)


def _invoke_prompt(prompt: str, temperature: float = 0.2) -> tuple[str | None, str | None]:
    config = _azure_openai_config()
    if not config:
        return None, "Azure OpenAI is not configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT."
    payload = json.dumps({
        "messages": [
            {"role": "system", "content": "Return only valid JSON. Do not use markdown fences or explanatory text."},
            {"role": "user", "content": prompt},
        ],
        "temperature": max(0, min(2, float(temperature))),
        "response_format": {"type": "json_object"},
    }).encode("utf-8")
    request_url = (
        f"{config.endpoint}/openai/deployments/{quote(config.deployment, safe='')}/chat/completions?"
        f"{urlencode({'api-version': config.api_version})}"
    )
    request = Request(
        request_url,
        data=payload,
        headers={"api-key": config.api_key, "Content-Type": "application/json"},
        method="POST",
    )
    for attempt in range(2):
        try:
            with urlopen(request, timeout=70) as response:
                result = json.loads(response.read().decode("utf-8"))
            text = _safe_text((((result.get("choices") or [{}])[0].get("message") or {}).get("content")), 100000)
            return (text, None) if text else (None, "Azure OpenAI returned an empty response")
        except HTTPError as exc:
            try:
                retry_seconds = float(exc.headers.get("Retry-After", ""))
            except (TypeError, ValueError):
                retry_seconds = 0
            if attempt == 0 and exc.code == 429 and 0 < retry_seconds <= 15:
                time.sleep(retry_seconds + 1)
                continue
            logger.error("Azure OpenAI invocation failed with HTTP %s", exc.code)
            return None, f"Azure OpenAI generation failed (HTTP {exc.code})"
        except (URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            logger.error("Azure OpenAI invocation failed: %s", exc)
            return None, "Azure OpenAI generation failed"
    return None, "Azure OpenAI generation failed"


def _invoke_prompt_with_timeout(prompt: str, temperature: float = 0.2, timeout_seconds: int = 30) -> tuple[str | None, str | None]:
    timeout_value = max(1, min(120, int(timeout_seconds)))
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_invoke_prompt, prompt, temperature)
        try:
            return future.result(timeout=timeout_value)
        except FuturesTimeoutError:
            future.cancel()
            return None, f"AI request timed out after {timeout_value} seconds"


def _extract_json_payload(raw_text: str):
    if not raw_text:
        return None
    text = raw_text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    for candidate in re.findall(r"(\{[\s\S]*\}|\[[\s\S]*\])", text):
        try:
            return json.loads(candidate)
        except Exception:
            continue
    return None
