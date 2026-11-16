#!/usr/bin/env python3
"""Valida los datos modificados en una PR para no romper la web.

Comprueba los JSON tocados bajo data/, la estructura de las fichas de partido, que los gamebooks
enlazados existan y sean PDF, la coherencia del índice de rivales y, en las ramas automáticas
(auto/*), que no se pisen datos que en la rama base ya estaban completos.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Callable

GAME_SCHEMA = {"name": "mundodolphins.hugo.sectioned-page", "version": "1.0.0"}
GAME_SECTIONS = ("Anotaciones", "Equipos", "Información del partido")
GAMES_PREFIX = "data/historical/games/"
RIVALS = "data/historical/rivals/index.json"
RIVAL_TOTALS = ("games", "wins", "losses", "ties", "points_for", "points_against")
INFO = "Información del partido"


def _check_game(root: Path, rel: str, page: dict) -> list[str]:
    errors = []
    if page.get("schema") != GAME_SCHEMA:
        errors.append(f"{rel}: schema inesperado {page.get('schema')}")
    if page.get("page", {}).get("kind") != "game":
        errors.append(f"{rel}: page.kind debe ser 'game'")
    sections = page.get("sections", {})
    for name in GAME_SECTIONS:
        if name not in sections:
            errors.append(f"{rel}: falta la sección {name}")
    gamebook = sections.get(INFO, {}).get("Gamebook oficial")
    if gamebook:
        path = root / gamebook
        if not path.is_file():
            errors.append(f"{rel}: Gamebook oficial {gamebook} no existe")
        elif not path.read_bytes()[:4] == b"%PDF":
            errors.append(f"{rel}: Gamebook oficial {gamebook} no es un PDF")
    return errors


def _check_rivals(rel: str, index: dict) -> list[str]:
    data = index.get("data", {})
    errors = []
    for key in RIVAL_TOTALS:
        total = data.get("totals", {}).get(key)
        summed = sum(r["summary"][key] for r in data.get("rivals", []))
        if total != summed:
            errors.append(f"{rel}: totals.{key}={total} no coincide con la suma de rivales ({summed})")
    return errors


def _check_guard(rel: str, page: dict, base_text: str | None, branch: str) -> list[str]:
    if base_text is None:
        return []
    base_info = json.loads(base_text).get("sections", {}).get(INFO, {})
    if branch == "auto/game-stats" and base_info.get("Estado") != "scheduled":
        return [f"{rel}: en la rama base ya está final; no se sobrescribe con datos automáticos"]
    if branch == "auto/gamebook" and base_info.get("Gamebook oficial"):
        return [f"{rel}: en la rama base ya tiene gamebook"]
    return []


def validate(root: Path, changed: list[str], base_reader: Callable[[str], str | None], branch: str) -> list[str]:
    errors = []
    for rel in changed:
        path = root / rel
        if not rel.startswith("data/") or not rel.endswith(".json") or not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            errors.append(f"{rel}: JSON inválido ({error})")
            continue
        if rel.startswith(GAMES_PREFIX):
            errors += _check_game(root, rel, data)
            if branch.startswith("auto/"):
                errors += _check_guard(rel, data, base_reader(rel), branch)
        elif rel == RIVALS:
            errors += _check_rivals(rel, data)
    return errors


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="ref de la rama base, p. ej. origin/main")
    parser.add_argument("--branch", default="", help="rama de la PR")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    diff = _git("diff", "--name-only", f"{args.base}...HEAD")
    if diff.returncode != 0:
        sys.exit(f"git diff falló: {diff.stderr}")
    changed = [line for line in diff.stdout.splitlines() if line]

    def base_reader(rel: str) -> str | None:
        shown = _git("show", f"{args.base}:{rel}")
        return shown.stdout if shown.returncode == 0 else None

    errors = validate(args.root, changed, base_reader, args.branch)
    for error in errors:
        print(f"::error::{error}")
    print(f"{len(changed)} ficheros revisados, {len(errors)} errores")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
