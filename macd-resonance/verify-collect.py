#!/usr/bin/env python3
"""Exercise snapshot publication with real archived bars and isolated files."""
import json
import gzip
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import collect
import backfill


class CollectorTests(unittest.TestCase):
    def test_primary_source_cannot_rewrite_verified_minute_prices(self):
        root = collect.DEST.parent
        archive = json.loads((root / "history-15.json").read_text())
        conflicts = json.loads((root / "minute-source-conflicts-20261123.json").read_text())["conflicts"]
        previous = [{"15": series["15"][-512:]} for series in archive["data"]]
        incoming = {}
        for i, (_, ticker, _) in enumerate(collect.INDICES):
            received = {c["t"]: c["received"] for c in conflicts if c["index"] == i}
            incoming[ticker] = [received.get(b["t"], b) for b in previous[i]["15"]]
        snapshot = {"data": previous, "providers": [{"15": "东方财富"} for _ in previous], "failed_sources": []}
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "latest.json"
            archived = destination.with_name("history-15.json")
            destination.write_text(json.dumps(snapshot))
            archived.write_text(json.dumps(archive))
            with (
                patch.object(collect, "DEST", destination),
                patch.object(collect, "PERIODS", {"15": 1800}),
                patch.object(collect, "get", side_effect=lambda _, ticker, *_args: (incoming[ticker], "东方财富")),
                patch.object(collect.time, "sleep"),
            ):
                collect.main()
            self.assertEqual(json.loads(destination.read_text())["data"], previous)
            self.assertEqual(json.loads(archived.read_text())["data"], archive["data"])

    def check_daily_archive_at(self, hour, minute, expected_day):
        # Actual Monday-morning long archive and the same day's actual close snapshot.
        root = collect.DEST.parent
        inputs = {name: json.loads((root / (name + ".json")).read_text())
                  for name in ("latest", "history-101", "history-102")}
        for obj in inputs.values():
            obj["data"] = [{period: [b for b in bars if b["t"][:10] <= "2026-11-23"]
                            for period, bars in series.items()} for series in obj["data"]]
        # Retained full history keeps this real historical regression reproducible
        # even after the rolling latest snapshot no longer contains November 2026.
        inputs["latest"]["data"] = [{period: backfill.merge(
            inputs["history-" + period]["data"][i][period],
            inputs["latest"]["data"][i].get(period, []))[-501:]
            for period in ("101", "102")} for i in range(4)]
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            for name, obj in inputs.items():
                (directory / (name + ".json")).write_text(json.dumps(obj))
            with (
                patch.object(backfill, "DIR", directory),
                patch.object(backfill, "LATEST", directory / "latest.json"),
                patch.object(backfill.dt, "datetime", wraps=collect.dt.datetime) as clock,
                patch.object(backfill.time, "sleep"),
                patch.object(backfill, "fetch_all", side_effect=AssertionError("Existing verified history suffices")),
            ):
                clock.now.return_value = collect.dt.datetime(2026, 11, 23, hour, minute)
                backfill.run()
            daily = json.loads((directory / "history-101.json").read_text())["data"]
            weekly = json.loads((directory / "history-102.json").read_text())["data"]
            for i in range(4):
                self.assertEqual(daily[i]["101"][-1]["t"], expected_day)
                self.assertEqual(daily[i]["101"][0], inputs["history-101"]["data"][i]["101"][0])
                self.assertEqual(weekly[i]["102"][-1]["t"], "2026-11-20")
                if expected_day == "2026-11-23":
                    self.assertEqual(daily[i]["101"][-1], inputs["latest"]["data"][i]["101"][-1])

    def test_morning_backfill_excludes_incomplete_daily_and_weekly(self):
        self.check_daily_archive_at(9, 42, "2026-11-20")

    def test_after_close_backfill_uses_actual_close_without_publishing_open_week(self):
        self.check_daily_archive_at(15, 8, "2026-11-23")

    def test_hourly_fallback_uses_verified_endpoint_and_preserves_recorded_ohlc(self):
        root = collect.DEST.parent
        frozen = json.loads(gzip.decompress((root / "hourly-source-check-20261123.json.gz").read_bytes()))
        latest = json.loads((root / "latest.json").read_text())
        for i, (_, ticker, _) in enumerate(collect.INDICES):
            source = frozen[ticker]
            self.assertEqual(hashlib.sha256(source["body"].encode()).hexdigest(), source["sha256"])
            with patch.object(collect, "retrieve_json", return_value=json.loads(source["body"])) as request:
                rows = collect.tencent(ticker, "60", 900)
            self.assertEqual(request.call_args.args[0], source["url"])
            self.assertEqual(len(rows), 640)
            self.assertEqual(rows[-1]["t"], "2026-11-23T15:00")
            # A fallback first seen at the exact close cannot freeze an unfinished hour.
            with (
                patch.object(collect.dt, "datetime", wraps=collect.dt.datetime) as clock,
                patch.object(collect, "eastmoney", return_value=rows),
            ):
                clock.now.return_value = collect.dt.datetime.fromisoformat(rows[-1]["t"])
                closed, _ = collect.get(collect.INDICES[i][0], ticker, "60", 900)
                self.assertEqual(closed, rows[:-1])
            previous = [b for b in latest["data"][i].get("60", []) if b["t"] <= "2026-11-20T15:00"]
            merged = collect.merge_minute_fallback(previous, [], rows, 900)
            by_time = {b["t"]: b for b in merged}
            self.assertTrue(all(by_time[b["t"]] == b for b in previous))
            self.assertEqual(merged[-1], rows[-1])
            if previous:
                self.assertEqual(merged[0], previous[0])

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
