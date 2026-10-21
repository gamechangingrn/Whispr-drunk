"""Persistent, offline Phonon-2 worker. JSONL control over inherited stdio.

The input reader never waits for inference. Cancellation invalidates in-flight
results; a single decoder owns the model. Only final utterances are committed.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import dataclasses
import hashlib
import json
import os
import pathlib
import queue
import sys
import threading
import time
from typing import Any

os.environ.update({
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
    "HF_HUB_DISABLE_TELEMETRY": "1", "DO_NOT_TRACK": "1",
    "TOKENIZERS_PARALLELISM": "false", "FERMION_DEVICE": "cpu",
    "OMP_WAIT_POLICY": "PASSIVE", "OPENBLAS_NUM_THREADS": "1",
})

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2
MAX_FRAME_BYTES = BYTES_PER_SECOND * 2
MAX_LINE_BYTES = 4 * 1024 * 1024
WRITE_LOCK = threading.Lock()
PROTOCOL_STDOUT = sys.stdout


def send(value: dict[str, Any]) -> None:
    with WRITE_LOCK:
        PROTOCOL_STDOUT.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")
        PROTOCOL_STDOUT.flush()


def response(request: dict, result: Any = None, error: str | None = None) -> None:
    if "id" not in request:
        return
    value = {"id": request["id"], "ok": error is None}
    value["error" if error else "result"] = error if error else result
    send(value)


@dataclasses.dataclass
class Session:
    id: str
    hotwords: list[str]
    audio: bytearray = dataclasses.field(default_factory=bytearray)
    pieces: dict[int, str] = dataclasses.field(default_factory=dict)
    segment: int = 0
    voiced: bool = False
    silence_samples: int = 0
    peak_rms: float = 0.0
    next_partial_samples: int = int(SAMPLE_RATE * 0.4)
    partial_pending: bool = False
    cancelled: bool = False
    ended: bool = False
    total_samples: int = 0
    error: str | None = None
    started: float = dataclasses.field(default_factory=time.perf_counter)


class Worker:
    def __init__(self, model_dir: pathlib.Path, threads: int):
        self.model_dir = model_dir
        self.threads = threads
        self.speech = None
        self.loading = False
        self.sessions: dict[str, Session] = {}
        self.lock = threading.RLock()
        self.jobs: queue.PriorityQueue = queue.PriorityQueue()
        self.sequence = 0
        self.stopping = threading.Event()
        self.peak_working = 0
        self.peak_private = 0
        self.decoder = threading.Thread(target=self.decode_loop, name="speech-decode", daemon=True)
        self.decoder.start()
        self.monitor = threading.Thread(target=self.sample_memory, name="speech-memory", daemon=True)
        self.monitor.start()

    def memory(self) -> dict:
        try:
            import psutil
            m = psutil.Process().memory_info()
            working = m.rss
            private = getattr(m, "private", getattr(m, "vms", 0))
            self.peak_working = max(self.peak_working, working, getattr(m, "peak_wset", 0))
            self.peak_private = max(self.peak_private, private)
            return {"workingSetBytes": working, "privateBytes": private,
                    "peakWorkingSetBytes": self.peak_working, "peakPrivateBytes": self.peak_private}
        except (ImportError, OSError):
            return {}

    def sample_memory(self) -> None:
        while not self.stopping.wait(0.1):
            self.memory()

    def enqueue(self, priority: int, kind: str, *args) -> None:
        with self.lock:
            self.sequence += 1
            self.jobs.put((priority, self.sequence, kind, args))

    def valid(self, session: Session) -> bool:
        return not session.cancelled and self.sessions.get(session.id) is session

    def load(self) -> dict:
        if self.speech is not None:
            return self.status()
        started = time.perf_counter()
        print("[speech] loading packed CPU engine", file=sys.stderr, flush=True)
        if not (self.model_dir / "model.fermion").is_file():
            raise RuntimeError("Speech model is missing. Run scripts/setup-speech.ps1 before using dictation.")
        pins = {
            "model.fermion": "4b6bfa3a12cc3c4e0a54f2ab3ec4ca7a842b09e5c7ecfc8e7ca0ac6cc8c11468",
            "config.json": "d0daad3b2a182893844f4abdc11e4f5b7083f7d42c8ad7e8203f71559785a31b",
            "packed_manifest.json": "3c1874501a1efb6ef569eab082aa68d91b93ec6e4d2fb00dbef7851edf2ae510",
        }
        for name, sha in pins.items():
            with (self.model_dir / name).open("rb") as artifact:
                if hashlib.file_digest(artifact, "sha256").hexdigest() != sha:
                    raise RuntimeError(f"Speech artifact failed integrity verification: {name}")
        os.environ["FERMION_CPU_THREADS"] = str(self.threads)
        os.environ["FERMION_P2_CPU"] = "onedot"
        import numpy as np
        import fermion
        # Third-party diagnostics go to stderr, preserving stdout as pure JSONL.
        with contextlib.redirect_stdout(sys.stderr):
            speech = fermion.load_speech(str(self.model_dir), quiet=True)
        checks = speech.decode.get("selftest", {})
        if not all(checks.get(k) for k in ("gemm_loaded", "enc_loaded", "tdt_loaded")):
            raise RuntimeError("Packed speech kernels did not pass startup validation; dense fallback is disabled.")
        with contextlib.redirect_stdout(sys.stderr):
            speech.transcribe_array(np.zeros(SAMPLE_RATE // 2, dtype=np.float32))
        self.speech = speech
        self.load_seconds = time.perf_counter() - started
        print(f"[speech] packed engine ready in {self.load_seconds:.2f}s", file=sys.stderr, flush=True)
        return self.status()

    def status(self) -> dict:
        return {"loaded": self.speech is not None, "loading": self.loading,
                "model": "Phonon-2", "backend": "cpu-packed", "threads": self.threads,
                "loadSeconds": getattr(self, "load_seconds", None), "memory": self.memory(),
                "selftest": self.speech.decode.get("selftest") if self.speech else None,
                "decode": self.speech.decode if self.speech else None,
                "activeSessions": sum(self.valid(s) and not s.ended for s in self.sessions.values())}

    def transcribe(self, audio: bytes, hotwords: list[str]) -> str:
        import numpy as np
        samples = np.frombuffer(audio, dtype="<i2").astype(np.float32) / 32768.0
        with contextlib.redirect_stdout(sys.stderr):
            text, _, _ = self.speech.transcribe_array(samples, hotwords=hotwords)
        return text.strip()

    def flush_segment(self, session: Session) -> None:
        if session.voiced and session.audio:
            audio = bytes(session.audio)
            index = session.segment
            session.segment += 1
            self.enqueue(0, "segment", session, index, audio)
        session.audio.clear()
        session.voiced = False
        session.silence_samples = 0
        session.peak_rms = 0.0
        session.next_partial_samples = int(SAMPLE_RATE * 0.4)

    def handle_audio(self, session: Session, request: dict) -> None:
        import numpy as np
        encoded = request.get("pcm", "")
        if not isinstance(encoded, str) or len(encoded) > MAX_FRAME_BYTES * 4 // 3 + 8:
            raise ValueError("Audio frames must contain at most two seconds of PCM.")
        data = base64.b64decode(encoded, validate=True)
        if len(data) % 2 or len(data) > MAX_FRAME_BYTES:
            raise ValueError("Audio must be signed 16-bit little-endian PCM at 16 kHz, mono.")
        # Analyse 50ms units even when a caller batches several frames.
        block_bytes = 1600
        for offset in range(0, len(data), block_bytes):
            block = data[offset:offset + block_bytes]
            x = np.frombuffer(block, dtype="<i2").astype(np.float32) / 32768.0
            if not x.size:
                continue
            rms = float(np.sqrt(np.mean(x * x)))
            session.audio.extend(block)
            session.total_samples += x.size
            session.peak_rms = max(session.peak_rms, rms)
            voice = rms > max(0.003, session.peak_rms * 0.12)
            if voice:
                session.voiced = True
                session.silence_samples = 0
            else:
                session.silence_samples += x.size
            samples = len(session.audio) // 2
            if session.voiced and (session.silence_samples >= int(SAMPLE_RATE * 0.7) or samples >= SAMPLE_RATE * 30):
                self.flush_segment(session)
            elif not session.voiced and samples > SAMPLE_RATE:
                del session.audio[:-BYTES_PER_SECOND]
            elif session.voiced and samples >= session.next_partial_samples:
                session.next_partial_samples = samples + int(SAMPLE_RATE * 0.5)
                if not session.partial_pending:
                    session.partial_pending = True
                    self.enqueue(2, "partial", session)

    def decode_loop(self) -> None:
        while not self.stopping.is_set():
            try:
                _, _, kind, args = self.jobs.get(timeout=0.2)
            except queue.Empty:
                continue
            request = None
            session = None
            try:
                if kind == "load":
                    request = args[0]
                    result = self.load()
                    self.loading = False
                    result["loading"] = False
                    response(request, result)
                    send({"event": "status", **self.status()})
                elif kind == "transcribe":
                    request = args[0]
                    self.load()
                    started = time.perf_counter()
                    import soundfile as sf
                    import scipy.signal
                    import numpy as np
                    if request.get("path"):
                        path = pathlib.Path(request["path"]).resolve(strict=True)
                        samples, rate = sf.read(str(path), dtype="float32", always_2d=True)
                        samples = samples.mean(axis=1)
                        if rate != SAMPLE_RATE:
                            import math
                            divisor = math.gcd(int(rate), SAMPLE_RATE)
                            samples = scipy.signal.resample_poly(samples, SAMPLE_RATE // divisor, int(rate) // divisor)
                        audio = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
                    else:
                        audio = base64.b64decode(request.get("pcm", ""), validate=True)
                    if len(audio) > BYTES_PER_SECOND * 600:
                        raise ValueError("Fixture transcription is limited to ten minutes.")
                    text = self.transcribe(audio, request.get("hotwords", [])[:25])
                    response(request, {"text": text, "audioSeconds": len(audio) / BYTES_PER_SECOND,
                                       "decodeSeconds": time.perf_counter() - started, "memory": self.memory()})
                elif kind in ("partial", "segment", "end"):
                    session = args[0]
                    with self.lock:
                        if not self.valid(session):
                            if kind == "end":
                                response(args[1], error="cancelled")
                            continue
                        if kind == "partial":
                            session.partial_pending = False
                            if session.ended or not session.voiced:
                                continue
                            index = session.segment
                            audio = bytes(session.audio)
                        elif kind == "segment":
                            _, index, audio = args
                    if kind == "end":
                        request = args[1]
                        with self.lock:
                            if session.error:
                                response(request, error=session.error)
                                self.sessions.pop(session.id, None)
                                continue
                            text = " ".join(session.pieces[k] for k in sorted(session.pieces) if session.pieces[k]).strip()
                            result = {"text": text, "sessionId": session.id, "audioSeconds": session.total_samples / SAMPLE_RATE,
                                      "elapsedSeconds": time.perf_counter() - session.started, "memory": self.memory()}
                            if self.valid(session):
                                send({"event": "final", **result})
                                response(request, result)
                                self.sessions.pop(session.id, None)
                        continue
                    text = self.transcribe(audio, session.hotwords)
                    with self.lock:
                        if not self.valid(session):
                            continue
                        if kind == "segment":
                            session.pieces[index] = text
                        elif index == session.segment and not session.ended:
                            full = " ".join([session.pieces[k] for k in sorted(session.pieces)] + [text]).strip()
                            send({"event": "partial", "sessionId": session.id, "text": full})
            except BaseException as exc:
                self.loading = False
                # Never include audio, text, a model prompt or request objects in diagnostics.
                code = type(exc).__name__
                message = str(exc) if isinstance(exc, (ValueError, RuntimeError, FileNotFoundError)) else f"Speech worker failed ({code})."
                if session is not None:
                    session.error = message
                response(request, error=message) if request else None
                send({"event": "error", "sessionId": session.id if session else None, "error": message, "code": code})
            finally:
                self.jobs.task_done()

    def handle(self, request: dict) -> None:
        operation = request.get("op")
        if operation == "load":
            if self.speech is not None:
                response(request, self.status())
            else:
                self.loading = True
                self.enqueue(0, "load", request)
            return
        if operation == "status":
            response(request, self.status())
            return
        if operation == "transcribe":
            self.enqueue(1, "transcribe", request)
            return
        if operation == "shutdown":
            self.stopping.set()
            response(request, {"stopped": True})
            return
        session_id = request.get("sessionId")
        if not isinstance(session_id, str) or not 1 <= len(session_id) <= 128:
            raise ValueError("A valid sessionId is required.")
        with self.lock:
            if operation == "begin":
                if self.speech is None:
                    raise RuntimeError("Speech engine is still loading.")
                if session_id in self.sessions:
                    raise ValueError("Session already exists.")
                for existing in self.sessions.values():
                    existing.cancelled = True
                self.sessions.clear()
                hotwords = request.get("hotwords", [])
                if not isinstance(hotwords, list) or any(not isinstance(x, str) or len(x) > 100 for x in hotwords):
                    raise ValueError("Hotwords must be a list of short strings.")
                self.sessions[session_id] = Session(session_id, hotwords[:25])
                response(request, {"sessionId": session_id, "sampleRate": SAMPLE_RATE, "format": "pcm_s16le"})
                return
            session = self.sessions.get(session_id)
            if not session or not self.valid(session):
                raise ValueError("Unknown or cancelled session.")
            if operation == "cancel":
                session.cancelled = True
                session.audio.clear()
                self.sessions.pop(session_id, None)
                response(request, {"cancelled": True})
            elif operation == "audio":
                if session.ended:
                    raise ValueError("Session has already ended.")
                self.handle_audio(session, request)
                response(request, {"accepted": True})
            elif operation == "end":
                if session.ended:
                    raise ValueError("Session has already ended.")
                session.ended = True
                self.flush_segment(session)
                self.enqueue(0, "end", session, request)
            else:
                raise ValueError("Unsupported speech operation.")


def main() -> None:
    if os.environ.get("WILLFULL_SPEECH_TRACE") == "1":
        import faulthandler
        faulthandler.dump_traceback_later(10, repeat=True, file=sys.stderr)
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[2] / "resources/models/phonon-2")
    parser.add_argument("--threads", type=int, default=6)
    args = parser.parse_args()
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8", write_through=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", write_through=True)
    # Load extension modules serially before starting threads. On Windows,
    # concurrent NumPy/OpenBLAS and _socket/psutil DLL initialization can wait
    # on the loader lock indefinitely when launched through anonymous pipes.
    import numpy
    import psutil
    import soundfile
    import scipy.signal
    worker = Worker(args.model_dir.resolve(), max(1, min(args.threads, 16)))
    send({"event": "ready", "protocol": 1, "loaded": False, "pid": os.getpid()})
    while not worker.stopping.is_set():
        raw = sys.stdin.buffer.readline(MAX_LINE_BYTES + 1)
        if not raw:
            break
        if len(raw) > MAX_LINE_BYTES:
            send({"event": "error", "error": "Control frame is too large."})
            break
        request = None
        try:
            request = json.loads(raw)
            if not isinstance(request, dict):
                raise ValueError("Control frames must be JSON objects.")
            worker.handle(request)
        except (ValueError, RuntimeError, TypeError) as exc:
            if isinstance(request, dict):
                response(request, error=str(exc))
            else:
                send({"event": "error", "error": "Invalid JSON control frame."})
    worker.stopping.set()


if __name__ == "__main__":
    main()
