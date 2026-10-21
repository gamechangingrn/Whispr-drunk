"""Real packaged-worker integration checks using public LibriSpeech audio."""
from __future__ import annotations
import array
import base64
import hashlib
import json
import pathlib
import queue
import re
import subprocess
import sys
import threading
import time
import wave

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).resolve().parent


def normalized(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).split()


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j - 1] + (x != y)))
        row = nxt
    return row[-1]


class Client:
    def __init__(self):
        print("Starting packaged speech worker...", flush=True)
        self.process = subprocess.Popen([sys.executable, "-u", str(HERE / "worker.py")],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1)
        self.messages = queue.Queue()
        self.events = []
        self.errors = []
        self.counter = 0
        threading.Thread(target=self.read, daemon=True).start()
        threading.Thread(target=self.read_errors, daemon=True).start()
        message = self.messages.get(timeout=15)
        assert message["event"] == "ready", message
        print("Worker protocol ready; loading model...", flush=True)

    def read(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                self.messages.put({"event": "invalid-output"})

    def read_errors(self):
        for line in self.process.stderr:
            self.errors.append(line.strip())
            print(line.rstrip(), file=sys.stderr, flush=True)

    def send(self, op, **args):
        self.counter += 1
        request = {"id": self.counter, "op": op, **args}
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        return self.counter

    def wait(self, id, timeout=120):
        deadline = time.perf_counter() + timeout
        while time.perf_counter() < deadline:
            message = self.messages.get(timeout=max(0.1, deadline - time.perf_counter()))
            if "event" in message:
                self.events.append(message)
            elif message.get("id") == id:
                if not message.get("ok"):
                    raise RuntimeError(message.get("error"))
                return message["result"]
        raise TimeoutError("Worker did not answer in time")

    def rpc(self, op, **args):
        return self.wait(self.send(op, **args))


def main():
    started = time.perf_counter()
    c = Client()
    try:
        load = c.rpc("load")
        print(f"Packed engine loaded in {load['loadSeconds']:.2f}s; testing fixtures...", flush=True)
        assert load["loaded"] and all(load["selftest"][key] for key in ("gemm_loaded", "enc_loaded", "tdt_loaded")), load
        fixtures = []
        for path in sorted((HERE / "fixtures").glob("*.wav")):
            result = c.rpc("transcribe", path=str(path))
            reference = path.with_suffix(".txt").read_text().strip()
            expected, actual = normalized(reference), normalized(result["text"])
            errors = edit_distance(expected, actual)
            assert result["text"].strip(), result
            fixtures.append({"fixture": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                             "reference": reference, "text": result["text"], "wordErrors": errors,
                             "referenceWords": len(expected), **{key: result[key] for key in ("audioSeconds", "decodeSeconds", "memory")}})
        assert sum(f["wordErrors"] for f in fixtures) <= 6, fixtures
        audio_path = HERE / "fixtures/5105-28240-0004.wav"
        with wave.open(str(audio_path), "rb") as wav:
            assert wav.getframerate() == 16000 and wav.getnchannels() == 1 and wav.getsampwidth() == 2
            pcm = wav.readframes(wav.getnframes())
        c.rpc("begin", sessionId="stream-fixture")
        for offset in range(0, len(pcm), 16000):
            c.rpc("audio", sessionId="stream-fixture", pcm=base64.b64encode(pcm[offset:offset+16000]).decode())
            time.sleep(0.02)
        end_start = time.perf_counter()
        streamed = c.rpc("end", sessionId="stream-fixture")
        release_seconds = time.perf_counter() - end_start
        finals = [e for e in c.events if e.get("event") == "final" and e.get("sessionId") == "stream-fixture"]
        assert len(finals) == 1 and finals[0]["text"] == streamed["text"], finals
        assert edit_distance(normalized(fixtures[1]["text"]), normalized(streamed["text"])) <= 2, streamed
        c.rpc("begin", sessionId="cancel-fixture")
        c.rpc("audio", sessionId="cancel-fixture", pcm=base64.b64encode(pcm[:32000]).decode())
        cancel_start = time.perf_counter()
        c.rpc("cancel", sessionId="cancel-fixture")
        cancel_seconds = time.perf_counter() - cancel_start
        c.rpc("begin", sessionId="silence-fixture")
        c.rpc("audio", sessionId="silence-fixture", pcm=base64.b64encode(bytes(32000)).decode())
        silence = c.rpc("end", sessionId="silence-fixture")
        assert silence["text"] == "", silence
        time.sleep(0.1)
        status = c.rpc("status")
        assert not any(e.get("event") == "final" and e.get("sessionId") == "cancel-fixture" for e in c.events)
        assert not any(e.get("event") in ("error", "invalid-output") for e in c.events), c.events
        report = {"passed": True, "scope": "Three real public English audio fixtures; streaming, cancellation and silence. Not a microphone/accent benchmark.",
                  "runtime": "Embedded Python 3.12.10 / Fermion 0.2.12 / torch 2.9.1+cpu", "load": load,
                  "fixtures": fixtures, "stream": {**streamed, "releaseToFinalSeconds": release_seconds},
                  "cancelResponseSeconds": cancel_seconds, "silenceText": silence["text"], "status": status,
                  "elapsedSeconds": time.perf_counter() - started, "stderr": c.errors}
        (HERE / "test-results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"passed": True, "fixtures": len(fixtures), "wordErrors": sum(f["wordErrors"] for f in fixtures),
                          "referenceWords": sum(f["referenceWords"] for f in fixtures), "loadSeconds": load["loadSeconds"],
                          "releaseToFinalSeconds": release_seconds, "cancelResponseSeconds": cancel_seconds,
                          "memory": status["memory"]}, indent=2))
    finally:
        if c.process.poll() is None:
            try:
                c.rpc("shutdown")
                c.process.wait(timeout=5)
            except Exception:
                c.process.kill()
                c.process.wait(timeout=5)


if __name__ == "__main__":
    main()
