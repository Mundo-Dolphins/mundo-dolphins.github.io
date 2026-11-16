import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).resolve().parents[4]
# Copia congelada de data/historical (main a 2026-11-16): los datos reales cambian con cada
# partido y los tests no deben depender de ellos.
DATA = FIXTURES / "data"


def load(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def fixture_loader():
    return load
