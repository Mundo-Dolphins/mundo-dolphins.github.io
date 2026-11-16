import copy
import json

import pytest

from validate_data import validate

from .conftest import REPO, DATA

GAME = "data/historical/games/2026/202611150clt.json"
RIVALS = "data/historical/rivals/index.json"


def scheduled_page():
    return json.loads((DATA / "games/2026/202611150clt.json").read_text(encoding="utf-8"))


def final_page(gamebook=None):
    page = scheduled_page()
    page["sections"]["Información del partido"]["Estado"] = "final"
    if gamebook:
        page["sections"]["Información del partido"]["Gamebook oficial"] = gamebook
    return page


def write(root, rel, data):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data, encoding="utf-8")


def no_base(path):
    return None


def base_of(page):
    return lambda path: json.dumps(page)


@pytest.fixture
def tmp_repo(tmp_path):
    write(tmp_path, GAME, final_page())
    return tmp_path


def test_valid_game(tmp_repo):
    assert validate(tmp_repo, [GAME], no_base, "feat/x") == []


def test_invalid_json(tmp_repo):
    write(tmp_repo, "data/historical/games/2026/roto.json", "{no es json")
    errors = validate(tmp_repo, ["data/historical/games/2026/roto.json"], no_base, "feat/x")
    assert any("JSON inválido" in e for e in errors)


def test_deleted_file_is_ignored(tmp_repo):
    assert validate(tmp_repo, ["data/borrado.json"], no_base, "feat/x") == []


def test_non_data_files_ignored(tmp_repo):
    write(tmp_repo, "static/x.json", "{no es json")
    assert validate(tmp_repo, ["static/x.json"], no_base, "feat/x") == []


def test_wrong_schema(tmp_repo):
    page = final_page()
    page["schema"]["version"] = "2.0.0"
    write(tmp_repo, GAME, page)
    assert any("schema" in e for e in validate(tmp_repo, [GAME], no_base, "feat/x"))


def test_missing_section(tmp_repo):
    page = final_page()
    del page["sections"]["Equipos"]
    write(tmp_repo, GAME, page)
    assert any("Equipos" in e for e in validate(tmp_repo, [GAME], no_base, "feat/x"))


def test_gamebook_must_exist(tmp_repo):
    write(tmp_repo, GAME, final_page("assets/gamebooks/2026/202611150clt.pdf"))
    assert any("Gamebook" in e for e in validate(tmp_repo, [GAME], no_base, "feat/x"))


def test_gamebook_must_be_pdf(tmp_repo):
    write(tmp_repo, GAME, final_page("assets/gamebooks/2026/202611150clt.pdf"))
    write(tmp_repo, "assets/gamebooks/2026/202611150clt.pdf", "<html></html>")
    assert any("PDF" in e for e in validate(tmp_repo, [GAME], no_base, "feat/x"))


def test_gamebook_ok(tmp_repo):
    write(tmp_repo, GAME, final_page("assets/gamebooks/2026/202611150clt.pdf"))
    (tmp_repo / "assets/gamebooks/2026").mkdir(parents=True)
    (tmp_repo / "assets/gamebooks/2026/202611150clt.pdf").write_bytes(b"%PDF-1.7")
    assert validate(tmp_repo, [GAME], no_base, "feat/x") == []


def test_current_rivals_index_is_consistent():
    assert validate(REPO, [RIVALS], no_base, "main") == []


def test_rivals_totals_mismatch(tmp_path):
    index = json.loads((DATA / "rivals/index.json").read_text(encoding="utf-8"))
    broken = copy.deepcopy(index)
    broken["data"]["totals"]["wins"] += 1
    write(tmp_path, RIVALS, broken)
    assert any("wins" in e for e in validate(tmp_path, [RIVALS], no_base, "feat/x"))


def test_guard_blocks_overwriting_final(tmp_repo):
    errors = validate(tmp_repo, [GAME], base_of(final_page()), "auto/game-stats")
    assert any("ya está final" in e for e in errors)


def test_guard_allows_scheduled_base(tmp_repo):
    assert validate(tmp_repo, [GAME], base_of(scheduled_page()), "auto/game-stats") == []


def test_guard_blocks_existing_gamebook(tmp_repo):
    write(tmp_repo, GAME, final_page("assets/gamebooks/2026/202611150clt.pdf"))
    (tmp_repo / "assets/gamebooks/2026").mkdir(parents=True)
    (tmp_repo / "assets/gamebooks/2026/202611150clt.pdf").write_bytes(b"%PDF-1.7")
    errors = validate(tmp_repo, [GAME], base_of(final_page("assets/gamebooks/2026/202611150clt.pdf")), "auto/gamebook")
    assert any("ya tiene gamebook" in e for e in errors)


def test_guard_ignored_for_human_branches(tmp_repo):
    assert validate(tmp_repo, [GAME], base_of(final_page()), "feat/x") == []


def test_guard_against_main_that_moved_after_branching(tmp_path):
    """phins-stats publica en main mientras la PR automática espera: re-validar contra main debe fallar."""
    import subprocess
    import sys

    from .conftest import REPO

    def git(*args):
        subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True)

    git("init", "-q", "-b", "main")
    git("config", "user.email", "t@t"), git("config", "user.name", "t")
    write(tmp_path, GAME, scheduled_page())
    git("add", "."), git("commit", "-qm", "scheduled")
    git("checkout", "-qb", "auto/game-stats")
    write(tmp_path, GAME, final_page())
    git("commit", "-qam", "auto")
    git("checkout", "-q", "main")
    complete = final_page()
    complete["sections"]["Oficiales"] = [{"Nombre": "phins-stats", "Posición": "Referee"}]
    write(tmp_path, GAME, complete)
    git("commit", "-qam", "phins-stats")
    git("checkout", "-q", "auto/game-stats")

    script = REPO / ".github/scripts/validate_data.py"
    result = subprocess.run([sys.executable, str(script), "--base", "main", "--branch", "auto/game-stats"],
                            cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 1 and "ya está final" in result.stdout
