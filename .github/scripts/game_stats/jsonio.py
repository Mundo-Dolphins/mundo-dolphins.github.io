"""Lectura y escritura de JSON con el mismo formato que encoding/json de Go (phins-stats),
para que los diffs solo muestren cambios de datos."""

import json
from pathlib import Path

# Go escapa estos caracteres dentro de las cadenas; fuera de ellas no pueden aparecer en JSON.
_GO_ESCAPES = {"&": "\\u0026", "<": "\\u003c", ">": "\\u003e", " ": "\\u2028", " ": "\\u2029"}


def dumps(data) -> str:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    for char, escaped in _GO_ESCAPES.items():
        text = text.replace(char, escaped)
    return text


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data) -> None:
    path.write_text(dumps(data), encoding="utf-8")
