"""Compatibility reports: adds one to compat/reports.json and rewrites COMPATIBILITY.md.

    python tools/compat.py add      adds the report in $PAYLOAD (JSON), then renders
    python tools/compat.py render   renders the table from compat/reports.json

Run by .github/workflows/compat.yml for each report the relay (github.com/haywirephoenix/webos-compat) passes on. Only
totals are kept, never single reports, so nothing in the repository ties answers to one TV.
"""
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "compat", "reports.json")
TABLE = os.path.join(ROOT, "COMPATIBILITY.md")

# The questions on the app's form, in table order. Keep in step with QUESTIONS in app/compat.js.
QUESTIONS = [
    ("starts", "Turns on"),
    ("orb", "Orb"),
    ("words", "Words right"),
    ("textbox", "Text boxes"),
    ("youtube", "YouTube"),
    ("boot", "After restart"),
]
# A TV is verified once someone says it turns on and gets their words right.
VERIFIED_BY = ("starts", "words")

PATTERNS = {
    "model": r"[A-Z0-9][A-Z0-9._-]{1,31}",
    "webos": r"\d{1,2}(\.\d{1,3}){0,3}",
    "version": r"\d{1,3}\.\d{1,3}\.\d{1,3}",
}


def load():
    try:
        with open(DATA, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {"total": 0, "tvs": {}}


def save(data):
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


def checked(report):
    """The report's fields, checked again here: the workflow trusts nothing it is sent."""
    if report.get("app") != "localvoice":
        raise ValueError("not a Local Voice report")
    for key, pattern in PATTERNS.items():
        if not isinstance(report.get(key), str) or not re.fullmatch(pattern, report[key]):
            raise ValueError("bad " + key)
    answers = report.get("answers")
    if not isinstance(answers, dict):
        raise ValueError("bad answers")
    known = {key for key, _ in QUESTIONS}
    yes = {k for k, v in answers.items() if k in known and v is True}
    return report["model"], report["webos"], report["version"], yes


def add(data, report, today):
    model, webos, version, yes = checked(report)
    key = model + " " + webos
    tv = data["tvs"].setdefault(key, {"model": model, "webos": webos, "reports": 0, "yes": {}})
    tv["reports"] += 1
    for k in yes:
        tv["yes"][k] = tv["yes"].get(k, 0) + 1
    if all(k in yes for k in VERIFIED_BY):
        tv["verified"] = True
    tv["version"] = max(tv.get("version", "0.0.0"), version, key=lambda v: [int(n) for n in v.split(".")])
    tv["last"] = today
    data["total"] += 1
    return data


def render(data):
    tvs = sorted(data["tvs"].values(), key=lambda t: (not t.get("verified"), -t["reports"], t["model"], t["webos"]))
    lines = [
        "# Compatibility",
        "",
        "TVs that people have tried Local Voice on, from the anonymous reports sent from the app's",
        "**Compatibility** card. Looking for testers: if your TV isn't here, or you have a different",
        "webOS version, please send a report.",
        "",
        "A tick means at least one person said Local Voice turned on and got their words right.",
        "Each column counts the reports that said yes.",
        "",
        "%d report%s so far." % (data["total"], "" if data["total"] == 1 else "s"),
        "",
    ]
    if tvs:
        head = ["", "TV", "webOS", "Reports"] + [label for _, label in QUESTIONS] + ["Latest version", "Last report"]
        lines.append("| " + " | ".join(head) + " |")
        lines.append("|" + "---|" * len(head))
        for t in tvs:
            cells = ["✅" if t.get("verified") else "", t["model"], t["webos"], str(t["reports"])]
            cells += ["%d/%d" % (t["yes"].get(k, 0), t["reports"]) for k, _ in QUESTIONS]
            cells += [t.get("version", ""), t.get("last", "")]
            lines.append("| " + " | ".join(cells) + " |")
    else:
        lines.append("No reports yet.")
    lines.append("")
    with open(TABLE, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    data = load()
    if command == "add":
        add(data, json.loads(os.environ["PAYLOAD"]), datetime.date.today().isoformat())
        save(data)
    elif command != "render":
        sys.exit(__doc__)
    render(data)


if __name__ == "__main__":
    main()
