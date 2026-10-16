from services.object_storage import PrivateObjectStorage, get_private_storage

AssignmentStorage = PrivateObjectStorage


def get_assignment_storage() -> AssignmentStorage:
    """Use the same private storage configuration as every API and worker."""
    return get_private_storage("assignments")
