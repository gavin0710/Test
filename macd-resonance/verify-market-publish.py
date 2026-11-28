"""Reproduce queued runners using real archives and a local bare Git remote."""
import datetime
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent


def run(folder, *args):
    result = subprocess.run(args, cwd=folder, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)
    return result.stdout.strip()


with tempfile.TemporaryDirectory(prefix="macd-publish-check-") as folder:
    root = Path(folder)
    origin, seed = root / "origin.git", root / "seed"
    run(root, "git", "init", "--bare", "-b", "master", str(origin))
    seed.mkdir()
    target = seed / "macd-resonance"
    target.mkdir()
    names = ["index.html", "analysis-data.json", "analysis-metrics.js", "analysis-patterns.js", "analysis-nine.js", "analysis-early.js", "research-success.js",
             "verify-success-analysis.js", "commit-market-update.sh"]
    for name in names:
        shutil.copyfile(SOURCE / name, target / name)
    (target / "data").mkdir()
    archives = ["latest", "history-15", "history-101", "history-102"]
    for name in archives:
        shutil.copyfile(SOURCE / "data" / (name + ".json"), target / "data" / (name + ".json"))
    run(seed, "git", "init", "-b", "master")
    run(seed, "git", "config", "user.name", "fixture")
    run(seed, "git", "config", "user.email", "fixture@example.invalid")
    run(seed, "git", "add", ".")
    run(seed, "git", "commit", "-m", "real-archive fixture")
    run(seed, "git", "remote", "add", "origin", str(origin))
    run(seed, "git", "push", "origin", "master")
    weekly, stale = root / "weekly", root / "queued-collector"
    for checkout in [weekly, stale]:
        run(root, "git", "clone", "--quiet", str(origin), str(checkout))

    # Both jobs checked out the same old SHA. Only capture timestamps change;
    # every price in the fixture remains the actual archived OHLC.
    stamps = [datetime.datetime.fromisoformat(json.loads((target / "data" / (name + ".json")).read_text())["generated_at_utc"]) for name in archives]
    cutoff = max(stamps)
    for checkout, name, minutes in [(weekly, "history-101", 2), (stale, "latest", 3)]:
        file = checkout / "macd-resonance/data" / (name + ".json")
        data = json.loads(file.read_text())
        data["generated_at_utc"] = (cutoff + datetime.timedelta(minutes=minutes)).isoformat()
        file.write_text(json.dumps(data, ensure_ascii=False))
        run(checkout, "node", "macd-resonance/research-success.js", "--refresh")
    run(weekly, "bash", "macd-resonance/commit-market-update.sh", "backfill")
    weekly_head = run(weekly, "git", "rev-parse", "HEAD")
    run(stale, "bash", "macd-resonance/commit-market-update.sh", "collect")
    assert run(stale, "git", "rev-parse", "HEAD^") == weekly_head, "Publish one consistent rebased commit"
    run(stale, "node", "macd-resonance/verify-success-analysis.js")
    for name, checkout in [("history-101", weekly), ("latest", stale)]:
        expected = (checkout / "macd-resonance/data" / (name + ".json")).read_bytes()
        assert (stale / "macd-resonance/data" / (name + ".json")).read_bytes() == expected
    head = run(stale, "git", "rev-parse", "HEAD")
    run(stale, "bash", "macd-resonance/commit-market-update.sh", "collect")
    assert run(stale, "git", "rev-parse", "HEAD") == head, "No-input-change run must not amend upstream"
    assert not run(stale, "git", "status", "--porcelain")
    print("MARKET_PUBLISH_PASS: stale runner rebases both archives, regenerates analysis and preserves no-op HEAD")
