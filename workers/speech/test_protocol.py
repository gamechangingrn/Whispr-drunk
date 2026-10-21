"""Bounded protocol/concurrency checks with a fake decoder; no model download."""
from __future__ import annotations
import base64
import importlib.util
import pathlib
import sys
import threading
import time
import unittest

# Embedded Python intentionally excludes the caller's folder from sys.path.
HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np
import psutil
import worker


class FakeSpeech:
    decode = {"selftest": {"gemm_loaded": True, "enc_loaded": True, "tdt_loaded": True}}

    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()
        self.lengths = []

    def transcribe_array(self, audio, **kwargs):
        self.lengths.append(len(audio))
        self.entered.set()
        self.release.wait(timeout=3)
        return "chunk", 0.01, len(audio) / 16000


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.messages = []
        self.original_send = worker.send
        worker.send = self.messages.append
        self.w = worker.Worker(HERE, 1)
        self.engine = FakeSpeech()
        self.w.speech = self.engine

    def tearDown(self):
        self.engine.release.set()
        self.w.stopping.set()
        self.w.decoder.join(timeout=2)
        worker.send = self.original_send

    def request(self, op, **args):
        self.w.handle({"id": len(self.messages) + 1, "op": op, **args})

    def wait_jobs(self):
        deadline = time.perf_counter() + 4
        while self.w.jobs.unfinished_tasks and time.perf_counter() < deadline:
            time.sleep(0.005)
        self.assertEqual(self.w.jobs.unfinished_tasks, 0)

    def test_thirty_second_boundary_and_single_final(self):
        self.request("begin", sessionId="long")
        frame = base64.b64encode(np.full(16000, 3000, dtype="<i2").tobytes()).decode()
        for _ in range(31):
            self.request("audio", sessionId="long", pcm=frame)
            self.assertLessEqual(len(self.w.sessions["long"].audio), 30 * 32000)
        self.request("end", sessionId="long")
        self.wait_jobs()
        finals = [m for m in self.messages if m.get("event") == "final"]
        self.assertEqual(len(finals), 1)
        self.assertEqual(finals[0]["text"], "chunk chunk")
        self.assertTrue(all(n <= 30 * 16000 for n in self.engine.lengths))
        with self.assertRaises(ValueError):
            self.request("end", sessionId="long")

    def test_cancel_during_decode_has_no_late_output(self):
        self.engine.release.clear()
        self.request("begin", sessionId="cancel")
        frame = base64.b64encode(np.full(16000, 3000, dtype="<i2").tobytes()).decode()
        self.request("audio", sessionId="cancel", pcm=frame)
        self.assertTrue(self.engine.entered.wait(timeout=1))
        started = time.perf_counter()
        self.request("cancel", sessionId="cancel")
        self.assertLess(time.perf_counter() - started, 0.1)
        before = len(self.messages)
        self.engine.release.set()
        self.wait_jobs()
        self.assertEqual(len(self.messages), before)

    def test_idle_audio_is_bounded_and_not_decoded(self):
        self.request("begin", sessionId="silent")
        frame = base64.b64encode(bytes(32000)).decode()
        for _ in range(65):
            self.request("audio", sessionId="silent", pcm=frame)
        self.assertLessEqual(len(self.w.sessions["silent"].audio), 32000)
        self.request("end", sessionId="silent")
        self.wait_jobs()
        self.assertEqual(self.engine.lengths, [])
        self.assertEqual([m for m in self.messages if m.get("event") == "final"][0]["text"], "")

    def test_invalid_frames_and_duplicate_session_rejected(self):
        self.request("begin", sessionId="a")
        with self.assertRaises(ValueError):
            self.request("begin", sessionId="a")
        with self.assertRaises(ValueError):
            self.request("audio", sessionId="a", pcm="not base64!")
        with self.assertRaises(ValueError):
            self.request("audio", sessionId="a", pcm=base64.b64encode(b"x").decode())
        with self.assertRaises(ValueError):
            self.request("audio", sessionId="a", pcm=base64.b64encode(bytes(64002)).decode())


if __name__ == "__main__":
    unittest.main(verbosity=2)
