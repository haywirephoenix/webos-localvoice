# Run with: python tests/compat.test.py
# Checks how tools/compat.py adds reports and renders the table.
import importlib.util
import os
import tempfile

spec = importlib.util.spec_from_file_location("compat", os.path.join(os.path.dirname(__file__), "..", "tools", "compat.py"))
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)

good = {"app": "localvoice", "model": "OLED55BX6LB", "webos": "5.4.3", "version": "0.4.5",
        "answers": {"starts": True, "orb": True, "words": True, "youtube": False, "made_up": True}}
data = {"total": 0, "tvs": {}}
compat.add(data, good, "2026-11-09")
compat.add(data, dict(good, version="0.4.4", answers={"starts": True}), "2026-11-10")
compat.add(data, dict(good, model="OLED65C1", webos="6.0", answers={"starts": True}), "2026-11-10")
tv = data["tvs"]["OLED55BX6LB 5.4.3"]
assert data["total"] == 3
assert tv["reports"] == 2 and tv["yes"] == {"starts": 2, "orb": 1, "words": 1}, tv
assert tv["verified"] and tv["version"] == "0.4.5" and tv["last"] == "2026-11-10"
assert not data["tvs"]["OLED65C1 6.0"].get("verified")

for bad in [dict(good, app="tailscale"), dict(good, model="a|b"), dict(good, webos="x"),
            dict(good, version="1.0"), dict(good, answers=[])]:
    try:
        compat.add(data, bad, "2026-11-10")
    except ValueError:
        pass
    else:
        raise AssertionError(bad)
assert data["total"] == 3

with tempfile.TemporaryDirectory() as d:
    compat.TABLE = os.path.join(d, "t.md")
    compat.render(data)
    text = open(compat.TABLE, encoding="utf-8").read()
    rows = [l for l in text.splitlines() if l.startswith("| ")]
    assert "3 reports so far." in text
    assert rows[1].startswith("| ✅ | OLED55BX6LB | 5.4.3 | 2 | 2/2 | 1/2 | 1/2 | 0/2 | 0/2 | 0/2 | 0.4.5 |"), rows[1]
    assert rows[2].startswith("|  | OLED65C1 | 6.0 | 1 |"), rows[2]
print("compat: all passed")
