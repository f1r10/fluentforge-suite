import os
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.gettempdir()) / "fluentforge-processing-tests"
_TEST_ROOT.mkdir(parents=True, exist_ok=True)

os.environ.setdefault(
    "PROCESSING_DB_PATH",
    str(_TEST_ROOT / "processing.db"),
)
