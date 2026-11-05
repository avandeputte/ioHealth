"""Who may call a route, declared on the route itself: `dependencies=[access.signed_in]` (or admin, public). The
markers come from iosuite-shared (app/auth.py). Every /api route carries one, and a test fails when one is missing.

- public: the sign-in endpoints, /v1/health, and the upload routes (which check the bearer token themselves)
- signed_in: an account: everything in the web app (there is nothing to see without one; each account sees its own data)
- admin: accounts and the sign-in settings
"""
from app.auth import auth

public = auth.access.public
signed_in = auth.access.signed_in
editor = auth.access.editor
admin = auth.access.admin
declared = auth.access.declared
