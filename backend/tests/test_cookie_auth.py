"""Sprint 6, the original implementation plan — cookie session, CSRF.

Docker-gated like every other real-database test in this project (`client`/
`seed_user`/`login` come from `tests/conftest.py`, and this exercises the
actual `/login` → cookie → protected-route round trip, not a mocked one).
"""

from tests.conftest import requires_docker


@requires_docker
class TestCookieAuth:
    def test_login_sets_access_refresh_and_csrf_cookies(self, client, seed_user):
        seed_user(role="student", email="cookie-student@example.edu", password="Str0ng!Pass99")

        response = client.post("/login", json={"email": "cookie-student@example.edu", "password": "Str0ng!Pass99"})

        assert response.status_code == 200
        cookie_names = {cookie.name for cookie in client.cookies.jar}
        assert {"campusgrade_access", "campusgrade_refresh", "campusgrade_csrf"} <= cookie_names

    def test_cookie_alone_authenticates_a_protected_route(self, client, seed_user):
        """No `Authorization` header sent at all — the httpOnly access
        cookie `/login` just set is what authenticates this request."""
        user = seed_user(role="student", email="cookie-only@example.edu")
        login_response = client.post("/login", json={"email": user["email"], "password": user["password"]})
        assert login_response.status_code == 200

        response = client.get("/auth/me")

        assert response.status_code == 200
        assert response.json()["role"] == "student"

    def test_auth_me_reflects_the_real_principal(self, client, seed_user):
        user = seed_user(role="teacher", email="cookie-teacher@example.edu")
        client.post("/login", json={"email": user["email"], "password": user["password"]})

        response = client.get("/auth/me")

        assert response.status_code == 200
        body = response.json()
        assert body["role"] == "teacher"
        assert body["status"] == "active"
        assert body["program_ids"] == []
        assert body["must_change_password"] is False

    def test_post_without_csrf_header_is_rejected(self, client, seed_user):
        user = seed_user(role="student", email="csrf-missing@example.edu")
        client.post("/login", json={"email": user["email"], "password": user["password"]})

        response = client.post("/me/sessions/revoke-others")

        assert response.status_code == 403
        assert "CSRF" in response.json()["detail"]

    def test_post_with_wrong_csrf_header_is_rejected(self, client, seed_user):
        user = seed_user(role="student", email="csrf-wrong@example.edu")
        client.post("/login", json={"email": user["email"], "password": user["password"]})

        response = client.post("/me/sessions/revoke-others", headers={"X-CSRF-Token": "not-the-real-token"})

        assert response.status_code == 403

    def test_post_with_matching_csrf_header_succeeds(self, client, seed_user):
        user = seed_user(role="student", email="csrf-correct@example.edu")
        client.post("/login", json={"email": user["email"], "password": user["password"]})
        csrf_token = next(cookie.value for cookie in client.cookies.jar if cookie.name == "campusgrade_csrf")

        response = client.post("/me/sessions/revoke-others", headers={"X-CSRF-Token": csrf_token})

        assert response.status_code == 200

    def test_login_itself_is_exempt_from_the_csrf_check(self, client, seed_user):
        """A request with no session yet can't be expected to already carry
        a matching CSRF token — /login has to be reachable without one."""
        user = seed_user(role="student", email="csrf-exempt@example.edu")

        response = client.post("/login", json={"email": user["email"], "password": user["password"]})

        assert response.status_code == 200
