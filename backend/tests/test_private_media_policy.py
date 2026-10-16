import unittest

from app import app


class PrivateMediaPolicyTests(unittest.TestCase):
    def test_application_does_not_mount_a_public_media_tree(self):
        paths = {getattr(route, "path", "") for route in app.routes}
        self.assertNotIn("/media", paths)
        self.assertFalse(any(path.startswith("/media/") for path in paths))


if __name__ == "__main__":
    unittest.main()
