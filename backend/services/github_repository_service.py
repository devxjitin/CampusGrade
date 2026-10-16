import asyncio
import datetime
import hashlib
import io
import json
import mimetypes
import re
import stat
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from collections import Counter

from config import get_settings
from models.assignment import (
    SqlAssignment,
    SqlAssignmentDuplicateFlag,
    SqlAssignmentEvaluationParticipant,
    SqlAssignmentGrade,
    SqlAssignmentGradeRevision,
    SqlAssignmentRubric,
    SqlAssignmentSubmission,
    SqlAssignmentSubmissionVersion,
)
from models.database import async_session_factory
from models.notification import SqlNotification
from models.sql_models import utcnow

from services.assignment_storage import get_assignment_storage

GITHUB_REPO_RE = re.compile(r"^https://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
MAX_ARCHIVE_BYTES = get_settings().assignment_max_archive_bytes
MAX_FILES = get_settings().assignment_max_files
MAX_TEXT_BYTES = get_settings().assignment_max_text_bytes
IGNORED_SIMILARITY_PARTS = {"node_modules", "vendor", "dist", "build", ".git", "coverage"}
LOCK_FILE_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "composer.lock"}
DEPENDENCY_FILES = {"package.json", "requirements.txt", "pyproject.toml", "pom.xml", "build.gradle", "go.mod", "Cargo.toml", "composer.json"}
CODE_SUFFIXES = {
    "py",
    "js",
    "jsx",
    "ts",
    "tsx",
    "java",
    "kt",
    "kts",
    "c",
    "h",
    "cpp",
    "hpp",
    "cs",
    "go",
    "rs",
    "rb",
    "php",
    "swift",
    "scala",
    "sql",
    "sh",
    "ps1",
    "vue",
    "svelte",
}
CODE_SIMILARITY_THRESHOLD = 0.70
MAX_CODE_FINGERPRINTS = 50_000
REPOSITORY_SYNC_INTERVAL_SECONDS = max(30, get_settings().repository_sync_interval_seconds)


class GitHubRepositoryError(ValueError):
    pass


class GitHubRateLimitError(GitHubRepositoryError):
    """Raised when GitHub REST metadata is temporarily quota limited."""


class GitHubUnavailableError(GitHubRepositoryError):
    """Raised when GitHub REST metadata cannot currently be reached."""


def normalize_repository_url(value: str) -> tuple[str, str, str]:
    raw = value.strip().rstrip("/")
    match = GITHUB_REPO_RE.fullmatch(raw)
    if not match:
        raise GitHubRepositoryError("Enter a public GitHub repository URL such as https://github.com/owner/repository")
    owner, repo = match.groups()
    return f"https://github.com/{owner}/{repo}", owner, repo


def _github_json(path: str):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "KRMU-CampusGrade/1.0", "X-GitHub-Api-Version": "2022-11-28"}
    token = (get_settings().github_token or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(f"https://api.github.com{path}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise GitHubRepositoryError("Repository was not found or is not public") from exc
        if exc.code in {403, 429}:
            raise GitHubRateLimitError("GitHub REST API quota is temporarily unavailable") from exc
        raise GitHubRepositoryError(f"GitHub rejected the repository request ({exc.code})") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise GitHubUnavailableError("GitHub REST metadata is currently unavailable") from exc


def _parse_git_advertisement(payload: bytes) -> tuple[str, str]:
    """Read HEAD and its default branch from Git's public smart-HTTP response."""
    head_match = re.search(
        rb"[0-9a-fA-F]{4}([0-9a-fA-F]{40}) HEAD\x00[^\n]*?symref=HEAD:refs/heads/([^\s\x00]+)",
        payload,
    )
    if head_match:
        return head_match.group(1).decode("ascii").lower(), head_match.group(2).decode("utf-8", errors="strict")

    head_sha_match = re.search(rb"[0-9a-fA-F]{4}([0-9a-fA-F]{40}) HEAD(?:\x00|\n)", payload)
    branches = re.findall(rb"[0-9a-fA-F]{4}([0-9a-fA-F]{40}) refs/heads/([^\s\x00]+)", payload)
    if not head_sha_match or not branches:
        raise GitHubRepositoryError("Empty repositories cannot be submitted")
    head_sha = head_sha_match.group(1).decode("ascii").lower()
    decoded = [(sha.decode("ascii").lower(), branch.decode("utf-8", errors="strict")) for sha, branch in branches]
    matching = next((branch for sha, branch in decoded if sha == head_sha), None)
    branch = matching or next((branch for _sha, branch in decoded if branch in {"main", "master"}), decoded[0][1])
    return head_sha, branch


def _github_public_head(owner: str, repo: str) -> tuple[str, str]:
    """Resolve an immutable public HEAD without consuming GitHub REST API quota."""
    encoded_owner = urllib.parse.quote(owner, safe="")
    encoded_repo = urllib.parse.quote(repo, safe="")
    url = f"https://github.com/{encoded_owner}/{encoded_repo}.git/info/refs?service=git-upload-pack"
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/x-git-upload-pack-advertisement",
            "User-Agent": "KRMU-CampusGrade/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = response.read(2 * 1024 * 1024)
    except urllib.error.HTTPError as exc:
        if exc.code in {401, 403, 404}:
            raise GitHubRepositoryError("Repository was not found or is not public") from exc
        raise GitHubRepositoryError(f"GitHub rejected public repository verification ({exc.code})") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise GitHubRepositoryError("GitHub is currently unavailable. Your repository link was not submitted") from exc
    return _parse_git_advertisement(payload)


def _public_transport_preview(normalized_url: str, owner: str, repo: str) -> dict:
    commit_sha, branch = _github_public_head(owner, repo)
    return {
        "repository_url": normalized_url,
        "owner": owner,
        "name": repo,
        "default_branch": branch,
        "commit_sha": commit_sha,
        "commit_message": "Commit details unavailable while GitHub metadata is limited",
        "commit_at": None,
        "description": None,
        "language": None,
        "stars": 0,
        "fork": False,
        "upstream": None,
        "verification_source": "git_transport",
        "verification_warning": "GitHub metadata is temporarily limited. The public repository and exact commit were securely verified through Git's read-only service.",
    }


def preview_repository(repository_url: str, github_username: str) -> dict:
    normalized_url, owner, repo = normalize_repository_url(repository_url)
    if not github_username:
        raise GitHubRepositoryError("Link your GitHub username in Profile before submitting")
    if owner.casefold() != github_username.strip().lstrip("@").casefold():
        raise GitHubRepositoryError("Repository owner must match the GitHub username linked to your profile")
    try:
        repository = _github_json(f"/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}")
    except (GitHubRateLimitError, GitHubUnavailableError):
        return _public_transport_preview(normalized_url, owner, repo)
    if repository.get("private"):
        raise GitHubRepositoryError("Private repositories are not supported in Assignment Mode")
    branch = repository.get("default_branch")
    if not branch:
        raise GitHubRepositoryError("Empty repositories cannot be submitted")
    try:
        commit = _github_json(f"/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repo)}/commits/{urllib.parse.quote(branch)}")
    except (GitHubRateLimitError, GitHubUnavailableError):
        return _public_transport_preview(normalized_url, owner, repo)
    commit_data = commit.get("commit") or {}
    author_data = commit_data.get("author") or {}
    return {
        "repository_url": normalized_url,
        "owner": owner,
        "name": repo,
        "default_branch": branch,
        "commit_sha": commit.get("sha"),
        "commit_message": commit_data.get("message") or "",
        "commit_at": author_data.get("date"),
        "description": repository.get("description"),
        "language": repository.get("language"),
        "stars": repository.get("stargazers_count", 0),
        "fork": bool(repository.get("fork")),
        "upstream": (repository.get("parent") or {}).get("full_name"),
        "verification_source": "github_api",
        "verification_warning": None,
    }


def _download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "KRMU-CampusGrade/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        length = int(response.headers.get("Content-Length") or 0)
        if length > MAX_ARCHIVE_BYTES:
            raise GitHubRepositoryError("Repository exceeds the 100 MB archive limit")
        data = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise GitHubRepositoryError("Repository exceeds the 100 MB archive limit")
    return data


def _code_fingerprints(source: str, width: int = 5) -> set[str]:
    """Create stable lexical shingles while ignoring comments and literal values."""
    normalized = re.sub(r"/\*[\s\S]*?\*/", " ", source)
    normalized = re.sub(r"(?m)//.*$", " ", normalized)
    normalized = re.sub(r"(?m)^\s*#.*$", " ", normalized)
    normalized = re.sub(r"(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')", " STR ", normalized)
    tokens = re.findall(r"[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|==|!=|<=|>=|=>|&&|\|\||[-+*/%<>{}()[\].,:;=]", normalized.lower())
    tokens = ["NUM" if token[0].isdigit() else token for token in tokens]
    if len(tokens) < width:
        return set()
    return {hashlib.sha1("\x1f".join(tokens[index : index + width]).encode()).hexdigest()[:20] for index in range(len(tokens) - width + 1)}


def code_similarity(left_fingerprints, right_fingerprints) -> float:
    left, right = set(left_fingerprints or []), set(right_fingerprints or [])
    if len(left) < 20 or len(right) < 20:
        return 0.0
    return len(left & right) / len(left | right)


def _safe_manifest(archive: bytes) -> tuple[list[dict], dict, str, str | None]:
    manifest = []
    languages = Counter()
    dependencies = []
    dependency_details = {}
    text_hashes = {}
    fingerprints = set()
    readme = None
    total_size = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        members = [member for member in bundle.infolist() if not member.is_dir()]
        if len(members) > MAX_FILES:
            raise GitHubRepositoryError("Repository exceeds the 10,000 file limit")
        for member in members:
            relative_parts = member.filename.split("/")[1:]
            if not relative_parts:
                continue
            if member.file_size < 0 or member.file_size > MAX_ARCHIVE_BYTES or member.compress_size > MAX_ARCHIVE_BYTES:
                raise GitHubRepositoryError("Repository contains an oversized file")
            if stat.S_ISLNK(member.external_attr >> 16):
                continue
            if member.file_size > 1024 * 1024 and member.compress_size and member.file_size / member.compress_size > 100:
                raise GitHubRepositoryError("Repository archive contains a suspicious compression ratio")
            if any(part in {"", ".", ".."} for part in relative_parts):
                raise GitHubRepositoryError("Repository archive contains an unsafe path")
            total_size += member.file_size
            if total_size > MAX_ARCHIVE_BYTES:
                raise GitHubRepositoryError("Repository exceeds the 100 MB extracted-size limit")
            path = "/".join(relative_parts)
            mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
            is_text = mime.startswith("text/") or path.rsplit(".", 1)[-1].lower() in {
                "js",
                "jsx",
                "ts",
                "tsx",
                "py",
                "java",
                "c",
                "cpp",
                "h",
                "hpp",
                "json",
                "yaml",
                "yml",
                "md",
                "html",
                "css",
                "sql",
                "xml",
                "toml",
            }
            digest_builder = hashlib.sha256()
            with bundle.open(member) as archived_file:
                while chunk := archived_file.read(1024 * 1024):
                    digest_builder.update(chunk)
            digest = digest_builder.hexdigest()
            if is_text and member.file_size <= MAX_TEXT_BYTES:
                raw = bundle.read(member)
                if not any(part in IGNORED_SIMILARITY_PARTS for part in relative_parts) and relative_parts[-1] not in LOCK_FILE_NAMES:
                    text_hashes[path] = digest
                    if suffix := (relative_parts[-1].rsplit(".", 1)[-1].lower() if "." in relative_parts[-1] else ""):
                        if suffix in CODE_SUFFIXES:
                            fingerprints.update(_code_fingerprints(raw.decode("utf-8", errors="replace")))
                if relative_parts[-1].lower().startswith("readme") and readme is None:
                    readme = raw.decode("utf-8", errors="replace")
            suffix = relative_parts[-1].rsplit(".", 1)[-1].lower() if "." in relative_parts[-1] else "other"
            languages[suffix] += member.file_size
            if relative_parts[-1] in DEPENDENCY_FILES:
                dependencies.append(path)
                if member.file_size <= MAX_TEXT_BYTES:
                    source = bundle.read(member).decode("utf-8", errors="replace")
                    declared = []
                    if relative_parts[-1] == "package.json":
                        try:
                            package = json.loads(source)
                            declared = sorted(set(package.get("dependencies") or {}) | set(package.get("devDependencies") or {}))
                        except (ValueError, TypeError):
                            declared = []
                    elif relative_parts[-1] == "requirements.txt":
                        declared = [line.strip() for line in source.splitlines() if line.strip() and not line.lstrip().startswith("#")][:300]
                    elif relative_parts[-1] == "pyproject.toml":
                        declared = [line.strip() for line in source.splitlines() if "=" in line and not line.lstrip().startswith(("#", "["))][:300]
                    dependency_details[path] = declared
            manifest.append({"path": path, "size": member.file_size, "mime": mime, "is_text": is_text, "hash": digest})
    folders = {str(item["path"]).rsplit("/", 1)[0] for item in manifest if "/" in str(item["path"])}
    summary = {
        "file_count": len(manifest),
        "folder_count": len(folders),
        "size_bytes": total_size,
        "languages": dict(languages.most_common(12)),
        "dependency_files": dependencies,
        "dependency_details": dependency_details,
        "text_hashes": text_hashes,
        "code_fingerprints": sorted(fingerprints)[:MAX_CODE_FINGERPRINTS],
        "code_fingerprint_count": min(len(fingerprints), MAX_CODE_FINGERPRINTS),
    }
    exact_files = sorted((item["path"], item["size"], item["hash"]) for item in manifest)
    content_digest = hashlib.sha256(json.dumps(exact_files, separators=(",", ":")).encode()).hexdigest()
    return manifest, summary, content_digest, readme


def _notify(db, user_id: str, title: str, message: str, notification_type: str = "assignment"):
    db.add(SqlNotification(id=str(uuid.uuid4()), user_id=user_id, type=notification_type, title=title, message=message, metadata_json={}))


def _refresh_duplicate_flag(flag, similarity):
    """Refresh detector evidence without rewriting a human/system review decision."""
    flag.similarity = similarity


def _detect_duplicates(db, version: SqlAssignmentSubmissionVersion, assignment_id: str):
    current_hashes = (version.analysis_summary or {}).get("text_hashes") or {}
    others = (
        db.query(SqlAssignmentSubmissionVersion, SqlAssignmentSubmission)
        .join(SqlAssignmentSubmission, SqlAssignmentSubmission.id == SqlAssignmentSubmissionVersion.submission_id)
        .filter(
            SqlAssignmentSubmission.assignment_id == assignment_id,
            SqlAssignmentSubmissionVersion.id != version.id,
            SqlAssignmentSubmission.active_version_id == SqlAssignmentSubmissionVersion.id,
        )
        .all()
    )
    for other, _submission in others:
        flag_type = None
        similarity = 0.0
        if other.repository_url.casefold() == version.repository_url.casefold():
            flag_type, similarity = "same_repository", 1.0
        elif other.commit_sha == version.commit_sha:
            flag_type, similarity = "same_commit", 1.0
        elif other.content_digest and other.content_digest == version.content_digest:
            flag_type, similarity = "identical_content", 1.0
        else:
            other_hashes = (other.analysis_summary or {}).get("text_hashes") or {}
            comparable = set(current_hashes) | set(other_hashes)
            matches = sum(1 for path in comparable if current_hashes.get(path) and current_hashes.get(path) == other_hashes.get(path))
            if len(comparable) >= 5 and matches / len(comparable) >= 0.9:
                flag_type, similarity = "high_file_overlap", matches / len(comparable)
        detected = [(flag_type, similarity)] if flag_type else []
        lexical_similarity = code_similarity(
            (version.analysis_summary or {}).get("code_fingerprints"),
            (other.analysis_summary or {}).get("code_fingerprints"),
        )
        if lexical_similarity > CODE_SIMILARITY_THRESHOLD:
            detected.append(("code_similarity", lexical_similarity))
        for detected_type, detected_similarity in detected:
            left, right = sorted([version.id, other.id])
            exists = (
                db.query(SqlAssignmentDuplicateFlag)
                .filter_by(assignment_id=assignment_id, left_version_id=left, right_version_id=right, flag_type=detected_type)
                .first()
            )
            if exists:
                _refresh_duplicate_flag(exists, detected_similarity)
            else:
                db.add(
                    SqlAssignmentDuplicateFlag(
                        id=str(uuid.uuid4()),
                        assignment_id=assignment_id,
                        left_version_id=left,
                        right_version_id=right,
                        flag_type=detected_type,
                        similarity=detected_similarity,
                        reviewed=detected_type == "code_similarity",
                        review_status="confirmed" if detected_type == "code_similarity" else "pending",
                        reviewed_at=utcnow() if detected_type == "code_similarity" else None,
                    )
                )


def finalize_evaluation_fetch(db, assignment_id: str) -> bool:
    """Complete a frozen cohort only after all submitted snapshots are analyzable."""
    assignment = db.query(SqlAssignment).filter_by(id=assignment_id).first()
    if not assignment or not assignment.evaluation_locked_at or not assignment.repository_fetch_started_at:
        return False
    participants = db.query(SqlAssignmentEvaluationParticipant).filter_by(assignment_id=assignment_id).all()
    version_ids = [row.submission_version_id for row in participants if row.submission_version_id]
    versions = (
        {row.id: row for row in db.query(SqlAssignmentSubmissionVersion).filter(SqlAssignmentSubmissionVersion.id.in_(version_ids)).all()}
        if version_ids
        else {}
    )
    if any(not versions.get(version_id) or versions[version_id].analysis_status != "ready" for version_id in version_ids):
        return False
    if assignment.repository_fetch_completed_at:
        return True
    participant_by_version = {row.submission_version_id: row for row in participants if row.submission_version_id}
    exact_flags = (
        db.query(SqlAssignmentDuplicateFlag)
        .filter(
            SqlAssignmentDuplicateFlag.assignment_id == assignment_id,
            SqlAssignmentDuplicateFlag.flag_type.in_(("same_repository", "same_commit", "identical_content")),
        )
        .all()
    )
    rubric = db.query(SqlAssignmentRubric).filter_by(assignment_id=assignment_id).order_by(SqlAssignmentRubric.position).all()
    rubric_scores = {row.id: 0 for row in rubric}
    affected = set()
    for flag in exact_flags:
        for version_id in (flag.left_version_id, flag.right_version_id):
            participant = participant_by_version.get(version_id)
            if participant:
                affected.add(participant.student_id)
    for student_id in affected:
        grade = db.query(SqlAssignmentGrade).filter_by(assignment_id=assignment_id, student_id=student_id).first()
        if grade:
            continue
        participant = next(row for row in participants if row.student_id == student_id)
        grade = SqlAssignmentGrade(
            id=str(uuid.uuid4()),
            assignment_id=assignment_id,
            student_id=student_id,
            submission_version_id=participant.submission_version_id,
            rubric_scores=rubric_scores,
            feedback="",
            total_awarded=0,
            is_missing=False,
            status="draft",
            revision=1,
            evaluated_at=utcnow(),
            evaluation_source="automatic_exact_duplicate",
            evaluation_metadata={
                "duplicate_flag_types": sorted(
                    {flag.flag_type for flag in exact_flags if participant.submission_version_id in {flag.left_version_id, flag.right_version_id}}
                ),
                "rubric_feedback": {
                    item.id: {
                        "what_was_done_well": "No independently assessable evidence was available for this criterion.",
                        "what_is_missing": f"The submitted repository exactly matched another submission, so independent achievement of {item.title} was not established.",
                    }
                    for item in rubric
                },
            },
        )
        db.add(grade)
        db.flush()
        db.add(
            SqlAssignmentGradeRevision(
                id=str(uuid.uuid4()),
                grade_id=grade.id,
                action="automatic_exact_duplicate_zero",
                snapshot={"total_awarded": 0, "evaluation_source": "automatic_exact_duplicate"},
                actor_id=None,
            )
        )
    assignment.repository_fetch_completed_at = utcnow()
    return True


def _sync_submission_repository(db, submission_id: str, *, source: str = "automatic", force: bool = False) -> dict:
    """Detect and queue the latest commit for one canonical, unfrozen repository."""
    version_id = None
    now = utcnow()
    try:
        submission = db.query(SqlAssignmentSubmission).filter_by(id=submission_id).with_for_update().first()
        if not submission or not submission.repository_url:
            return {"status": "unlinked"}
        assignment = db.query(SqlAssignment).filter_by(id=submission.assignment_id).first()
        if submission.freeze_requested_at or (assignment and assignment.due_at and now >= assignment.due_at):
            return {"status": "frozen"}
        if not force and submission.next_sync_at and now < submission.next_sync_at:
            return {"status": submission.sync_status, "unchanged": True}
        generation = submission.repository_generation
        repository_url = submission.repository_url
        repository_owner = submission.repository_owner or ""
        submission.next_sync_at = now + datetime.timedelta(seconds=REPOSITORY_SYNC_INTERVAL_SECONDS)
        submission.sync_status = "checking"
        db.commit()
        try:
            preview = preview_repository(repository_url, repository_owner)
        except GitHubRepositoryError as exc:
            submission = db.query(SqlAssignmentSubmission).filter_by(id=submission_id).with_for_update().first()
            if not submission or submission.repository_generation != generation or submission.freeze_requested_at:
                db.rollback()
                return {"status": "stale"}
            submission.last_sync_checked_at = now
            submission.sync_failure_count += 1
            submission.sync_status = "sync_error"
            submission.sync_error = str(exc)[:1000]
            delay = min(1800, REPOSITORY_SYNC_INTERVAL_SECONDS * (2 ** min(submission.sync_failure_count, 4)))
            submission.next_sync_at = now + datetime.timedelta(seconds=delay)
            db.commit()
            return {"status": "sync_error", "error": submission.sync_error}

        submission = db.query(SqlAssignmentSubmission).filter_by(id=submission_id).with_for_update().first()
        if submission.freeze_requested_at or submission.repository_generation != generation:
            db.rollback()
            return {"status": "frozen" if submission.freeze_requested_at else "reset"}
        submission.last_sync_checked_at = now
        submission.next_sync_at = now + datetime.timedelta(seconds=REPOSITORY_SYNC_INTERVAL_SECONDS)
        submission.sync_failure_count = 0
        submission.sync_error = None
        submission.default_branch = preview["default_branch"]
        if preview["commit_sha"] == submission.latest_remote_sha:
            existing = (
                db.query(SqlAssignmentSubmissionVersion)
                .filter_by(submission_id=submission.id, repository_generation=generation, commit_sha=preview["commit_sha"])
                .first()
            )
            if existing and existing.analysis_status != "ready":
                existing.analysis_status, existing.analysis_error = "queued", None
                submission.pending_version_id, submission.sync_status = existing.id, "syncing"
            else:
                submission.sync_status = "live" if submission.active_version_id else "syncing"
                db.commit()
                return {"status": submission.sync_status, "unchanged": True}

        commit_at = datetime.datetime.fromisoformat(preview["commit_at"].replace("Z", "+00:00")).replace(tzinfo=None) if preview.get("commit_at") else None
        version = (
            db.query(SqlAssignmentSubmissionVersion)
            .filter_by(submission_id=submission.id, repository_generation=generation, commit_sha=preview["commit_sha"])
            .first()
        )
        if not version:
            version = SqlAssignmentSubmissionVersion(
                id=str(uuid.uuid4()),
                submission_id=submission.id,
                repository_generation=generation,
                detected_at=now,
                detection_source=source,
                repository_url=submission.repository_url,
                repository_owner=submission.repository_owner,
                repository_name=submission.repository_name,
                default_branch=preview["default_branch"],
                commit_sha=preview["commit_sha"],
                commit_message=preview.get("commit_message"),
                commit_at=commit_at,
                submitted_at=now,
                is_late=False,
                seconds_late=0,
                analysis_status="queued",
            )
            db.add(version)
            db.flush()
        submission.latest_remote_sha = preview["commit_sha"]
        submission.pending_version_id = version.id
        submission.sync_status = "syncing"
        submission.last_submitted_at = now
        version_id = version.id
        db.commit()
    finally:
        pass
    return {"status": "syncing", "version_id": version_id}


async def sync_submission_repository(db, submission_id: str, *, source: str = "automatic", force: bool = False, background_tasks=None) -> dict:
    result = await db.run_sync(lambda sync_db: _sync_submission_repository(sync_db, submission_id, source=source, force=force))
    version_id = result.get("version_id")
    if version_id:
        queued = enqueue_repository_analysis(version_id, background_tasks)
        if queued == "unavailable":
            await asyncio.to_thread(analyze_repository_version, version_id)
    return result


def _due_repository_ids(db, limit: int = 50) -> list[str]:
    """Claim a bounded set of live submissions; individual sync is idempotent."""
    now = utcnow()
    try:
        ids = [
            row[0]
            for row in db.query(SqlAssignmentSubmission.id)
            .join(SqlAssignment, SqlAssignment.id == SqlAssignmentSubmission.assignment_id)
            .filter(
                SqlAssignmentSubmission.repository_url.is_not(None),
                SqlAssignmentSubmission.freeze_requested_at.is_(None),
                SqlAssignment.status == "published",
                SqlAssignment.due_at > now,
                (SqlAssignmentSubmission.next_sync_at.is_(None) | (SqlAssignmentSubmission.next_sync_at <= now)),
            )
            .order_by(SqlAssignmentSubmission.next_sync_at.asc().nullsfirst())
            .limit(limit)
            .all()
        ]
    finally:
        pass
    return ids


async def sync_due_repositories(limit: int = 50) -> int:
    if async_session_factory is None:
        return 0
    async with async_session_factory() as db:
        ids = await db.run_sync(lambda sync_db: _due_repository_ids(sync_db, limit))
        for submission_id in ids:
            await sync_submission_repository(db, submission_id)
    return len(ids)


def _analyze_repository_version(db, version_id: str) -> None:
    storage = get_assignment_storage()
    version = None
    try:
        version = db.query(SqlAssignmentSubmissionVersion).filter_by(id=version_id).first()
        if not version or version.analysis_status == "ready":
            return
        version.analysis_status = "processing"
        version.analysis_error = None
        db.commit()
        archive = _download(
            f"https://codeload.github.com/{urllib.parse.quote(version.repository_owner)}/{urllib.parse.quote(version.repository_name)}/zip/{urllib.parse.quote(version.commit_sha)}"
        )
        manifest, summary, digest, readme = _safe_manifest(archive)
        try:
            encoded_owner, encoded_name = urllib.parse.quote(version.repository_owner), urllib.parse.quote(version.repository_name)
            repo_meta = _github_json(f"/repos/{encoded_owner}/{encoded_name}")
            branches = _github_json(f"/repos/{encoded_owner}/{encoded_name}/branches?per_page=100")
            contributors = _github_json(f"/repos/{encoded_owner}/{encoded_name}/contributors?per_page=100")
            commits = _github_json(f"/repos/{encoded_owner}/{encoded_name}/commits?sha={urllib.parse.quote(version.default_branch)}&per_page=100")
            summary["repository"] = {
                "description": repo_meta.get("description"),
                "license": (repo_meta.get("license") or {}).get("spdx_id"),
                "stars": repo_meta.get("stargazers_count", 0),
                "forks": repo_meta.get("forks_count", 0),
                "open_issues": repo_meta.get("open_issues_count", 0),
                "fork": bool(repo_meta.get("fork")),
                "upstream": (repo_meta.get("parent") or {}).get("full_name"),
            }
            summary["branches"] = [{"name": item.get("name"), "sha": (item.get("commit") or {}).get("sha")} for item in branches[:100]]
            summary["contributors"] = [
                {"login": item.get("login"), "contributions": item.get("contributions", 0)} for item in contributors[:100] if item.get("login")
            ]
            summary["recent_commits"] = [
                {
                    "sha": item.get("sha"),
                    "message": ((item.get("commit") or {}).get("message") or "").splitlines()[0],
                    "author": (((item.get("commit") or {}).get("author") or {}).get("name")),
                    "date": (((item.get("commit") or {}).get("author") or {}).get("date")),
                }
                for item in commits[:100]
            ]
        except GitHubRepositoryError:
            summary["github_metadata_warning"] = "Repository structure was archived, but extended GitHub activity metadata could not be loaded."
        prefix = f"repositories/{version.submission_id}/{version.id}"
        archive_key, manifest_key = f"{prefix}.zip", f"{prefix}-manifest.json"
        storage.put_bytes(archive_key, archive, "application/zip")
        storage.put_bytes(manifest_key, json.dumps(manifest).encode(), "application/json")
        summary["text_hashes"] = summary.get("text_hashes", {})
        version.archive_key, version.manifest_key = archive_key, manifest_key
        version.analysis_summary, version.content_digest, version.readme_markdown = summary, digest, readme
        version.analysis_status = "ready"
        submission = db.query(SqlAssignmentSubmission).filter_by(id=version.submission_id).first()
        if submission:
            submission.status = "submitted"
            if version.repository_generation == submission.repository_generation:
                is_current = version.commit_sha == submission.latest_remote_sha
                is_frozen_target = bool(submission.freeze_requested_at and is_current)
                if is_current:
                    submission.active_version_id = version.id
                    submission.pending_version_id = None
                    submission.last_sync_completed_at = utcnow()
                    submission.sync_status = "frozen" if submission.freeze_requested_at else "live"
                if is_frozen_target:
                    submission.frozen_version_id = version.id
                    submission.frozen_at = utcnow()
            _detect_duplicates(db, version, submission.assignment_id)
            assignment = db.query(SqlAssignment).filter_by(id=submission.assignment_id).first()
            if assignment:
                finalize_evaluation_fetch(db, assignment.id)
                _notify(db, assignment.created_by, "Repository analysis ready", f"{version.repository_name} is ready for teacher review.")
        db.commit()
    except Exception as exc:
        db.rollback()
        if version:
            version = db.query(SqlAssignmentSubmissionVersion).filter_by(id=version_id).first()
            version.analysis_status, version.analysis_error = "failed", str(exc)[:2000]
            submission = db.query(SqlAssignmentSubmission).filter_by(id=version.submission_id).first()
            if submission:
                submission.status = "submitted"
                if version.repository_generation == submission.repository_generation and version.commit_sha == submission.latest_remote_sha:
                    submission.sync_status = "sync_error"
                    submission.sync_error = version.analysis_error
                assignment = db.query(SqlAssignment).filter_by(id=submission.assignment_id).first()
                if assignment:
                    _notify(
                        db,
                        assignment.created_by,
                        "Repository analysis failed",
                        f"Analysis of {version.repository_name} failed and can be retried from teacher review.",
                    )
            db.commit()
    finally:
        pass


async def _analyze_repository_version_async(version_id: str) -> None:
    if async_session_factory is None:
        raise RuntimeError("Repository analysis database is unavailable")
    async with async_session_factory() as db:
        await db.run_sync(lambda sync_db: _analyze_repository_version(sync_db, version_id))


def analyze_repository_version(version_id: str) -> None:
    """RQ/background-task entrypoint backed by the single async engine."""
    asyncio.run(_analyze_repository_version_async(version_id))


def enqueue_repository_analysis(version_id: str, background_tasks=None) -> str:
    try:
        from redis import Redis
        from rq import Queue, Retry

        connection = Redis.from_url(get_settings().redis_url)
        connection.ping()
        Queue("assignment-analysis", connection=connection).enqueue(
            analyze_repository_version, version_id, job_timeout=300, retry=Retry(max=3, interval=[10, 30, 60])
        )
        return "queued"
    except Exception:
        if background_tasks is not None:
            background_tasks.add_task(analyze_repository_version, version_id)
            return "background"
        return "unavailable"


def read_repository_file(version: SqlAssignmentSubmissionVersion, requested_path: str) -> tuple[bytes, str]:
    if version.analysis_status != "ready" or not version.archive_key:
        raise FileNotFoundError("Repository analysis is not ready")
    safe_path = requested_path.strip("/")
    if not safe_path or ".." in safe_path.split("/"):
        raise ValueError("Invalid repository path")
    archive = get_assignment_storage().get_bytes(version.archive_key)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        matches = [name for name in bundle.namelist() if "/".join(name.split("/")[1:]) == safe_path]
        if not matches:
            raise FileNotFoundError("Repository file not found")
        info = bundle.getinfo(matches[0])
        if info.file_size > MAX_TEXT_BYTES:
            raise ValueError("File exceeds the 1 MB source-view limit")
        data = bundle.read(info)
    return data, mimetypes.guess_type(safe_path)[0] or "text/plain"
