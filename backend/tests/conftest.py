"""Test-only environment defaults.

`app.main` validates secrets at import time. CI has no .env file, so provide
throwaway values here (only when nothing is configured) so the app can load.
These are never used outside the test process.
"""

import os

from cryptography.fernet import Fernet

os.environ.setdefault("GITHUB_STATE_SECRET", "test-only-state-secret-" + "x" * 24)
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
