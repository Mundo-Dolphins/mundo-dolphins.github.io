"""JSON helpers that match the output of Go's encoding/json.

The data files are also written by ivoox-scrapper (Go) on the Raspberry Pi,
so the backup workflows must produce byte-identical files to avoid noisy
diffs: two-space indent, trailing newline, and Go's HTML-safe escaping.
"""

import json
from datetime import datetime, timezone

_GO_ESCAPES = {
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    " ": "\\u2028",
    " ": "\\u2029",
}


def dumps(value) -> str:
    """Serialize like json.Encoder with SetIndent("", "  ")."""
    text = json.dumps(value, ensure_ascii=False, indent=2)
    for char, escaped in _GO_ESCAPES.items():
        text = text.replace(char, escaped)
    return text + "\n"


def write(path, value) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(dumps(value))


def read(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def parse_time(value: str) -> datetime:
    """Parse an RFC 3339 timestamp (Go's time.Time JSON format)."""
    if value.startswith("0001-01-01"):
        return datetime.min.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def format_time(value: datetime) -> str:
    """Format like Go's time.Time MarshalJSON (RFC 3339 nano, UTC "Z")."""
    value = value.astimezone(timezone.utc)
    text = value.strftime("%Y-%m-%dT%H:%M:%S")
    if value.microsecond:
        text += ("." + f"{value.microsecond:06d}").rstrip("0")
    return text + "Z"
