#!/usr/bin/env python3
"""Exercise snapshot publication with real archived bars and isolated files."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collect


class CollectorTests(unittest.TestCase):
    def test_new_bars_publish_with_the_same_provider_and_errors(self):
        root = collect.DEST.parent
        archived = json.loads((root / "history-15.json").read_text(encoding="utf-8"))
        previous = [{"15": item["15"][-81:-1]} for item in archived["data"]]
        incoming = {
            ticker: archived["data"][i]["15"][-80:]
            for i, (_, ticker, _) in enumerate(collect.INDICES)
        }
        archive = {
            "data": [{"15": item["15"][:-1]} for item in archived["data"]],
            "period": "15",
        }
        snapshot = {
            "data": previous,
            "providers": [{"15": "东方财富"} for _ in previous],
            "failed_sources": [],
        }

        with tempfile.TemporaryDirectory() as directory:
            latest_path = Path(directory) / "latest.json"
            archive_path = latest_path.with_name("history-15.json")
            latest_path.write_text(json.dumps(snapshot), encoding="utf-8")
            archive_path.write_text(json.dumps(archive), encoding="utf-8")
            with (
                patch.object(collect, "DEST", latest_path),
                patch.object(collect, "PERIODS", {"15": 80}),
                patch.object(collect, "get", side_effect=lambda _, ticker, *_args: (incoming[ticker], "东方财富")),
                patch.object(collect.time, "sleep"),
            ):
                collect.main()
                published_text = latest_path.read_text(encoding="utf-8")
                published = json.loads(published_text)
                self.assertEqual(published["data"], [{"15": rows} for rows in incoming.values()])
                self.assertEqual(published["providers"], snapshot["providers"])
                self.assertEqual(published["failed_sources"], snapshot["failed_sources"])
                self.assertEqual(json.loads(archive_path.read_text(encoding="utf-8"))["data"], archived["data"])
                collect.main()
                self.assertEqual(latest_path.read_text(encoding="utf-8"), published_text)

    def test_archive_waits_for_the_close_minute_to_pass(self):
        archive = json.loads((collect.DEST.parent / "history-15.json").read_text(encoding="utf-8"))
        bars = archive["data"][3]["15"][-80:]
        close_minute = collect.dt.datetime.fromisoformat(bars[-1]["t"])
        secid, ticker, _ = collect.INDICES[3]
        with (
            patch.object(collect.dt, "datetime", wraps=collect.dt.datetime) as clock,
            patch.object(collect, "eastmoney", return_value=bars),
        ):
            clock.now.return_value = close_minute
            rows, _ = collect.get(secid, ticker, "15", 80)
            self.assertEqual(rows, bars[:-1])

    def test_fallback_restores_gaps_without_replacing_recorded_prices(self):
        root = collect.DEST.parent
        archive = json.loads((root / "history-15.json").read_text(encoding="utf-8"))
        before, gap, archived, newest, missing = archive["data"][3]["15"][-5:]
        different = {**archived, "o": archived["c"]}
        earlier = {**newest, "o": newest["c"]}
        self.assertEqual(
            collect.merge_minute_fallback(
                [newest], [before, gap, archived, newest],
                [before, gap, different, earlier, missing], 10,
            ),
            [newest, missing],
        )
        self.assertEqual(
            collect.merge_minute_fallback(
                [before, newest], [before, archived], [gap, different, earlier, missing], 10,
            ),
            [before, gap, archived, newest, missing],
        )


if __name__ == "__main__":
    unittest.main()
