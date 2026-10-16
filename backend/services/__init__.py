"""Business services used by the FastAPI route layer.

Import concrete services from their modules to avoid loading database and web
dependencies when a standalone pure service is used in a worker or test.
"""

__all__ = [
    "academic_service", "assignment_external_evaluation", "assignment_storage",
    "auth_service", "github_repository_service", "object_storage", "session_service",
    "user_service",
]
