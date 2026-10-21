"""Download and verify the pinned Phonon-2 release. No runtime network calls."""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import shutil
import tarfile
import urllib.request

REVISION = "fb09063c9dc8e130d97b3a2191ed5aed6b71bb31"
BASE = f"https://huggingface.co/FermionResearch/Phonon-2/resolve/{REVISION}"
FILES = {
    "phonon-2.bps.tar.zst": "98125795b6dda72f5c6eee9ba33d19815df65dcb18b50a357bf9f73c9935309e",
    "NOTICE": "00624a5043e7ce74029317b024132ca5286116d6fbf3191d226374bc8273789f",
    "LICENSE-WEIGHTS-CC-BY-4.0.txt": "9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411",
    "LICENSE-CODE-Apache-2.0.txt": "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
}
EXTRACTED_FILES = {
    "model.fermion": "4b6bfa3a12cc3c4e0a54f2ab3ec4ca7a842b09e5c7ecfc8e7ca0ac6cc8c11468",
    "config.json": "d0daad3b2a182893844f4abdc11e4f5b7083f7d42c8ad7e8203f71559785a31b",
    "packed_manifest.json": "3c1874501a1efb6ef569eab082aa68d91b93ec6e4d2fb00dbef7851edf2ae510",
}


def digest(path: pathlib.Path) -> str:
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def download(name: str, dest: pathlib.Path, expected: str) -> None:
    if dest.is_file() and digest(dest) == expected:
        return
    temp = dest.with_suffix(dest.suffix + ".part")
    print(f"Downloading {name}...", flush=True)
    with urllib.request.urlopen(BASE + "/" + name, timeout=120) as response, temp.open("wb") as out:
        shutil.copyfileobj(response, out, length=1024 * 1024)
    if digest(temp) != expected:
        temp.unlink(missing_ok=True)
        raise RuntimeError(f"SHA-256 verification failed for {name}")
    temp.replace(dest)


def main() -> None:
    args = argparse.ArgumentParser()
    args.add_argument("--root", type=pathlib.Path, required=True)
    root = args.parse_args().root.resolve()
    model = root / "resources/models/phonon-2"
    cache = root / "resources/runtime/downloads"
    model.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    for name, sha in FILES.items():
        download(name, (cache if name.endswith(".zst") else model) / name, sha)
    archive = cache / "phonon-2.bps.tar.zst"
    if not all((model / name).is_file() and digest(model / name) == sha for name, sha in EXTRACTED_FILES.items()):
        import zstandard
        with archive.open("rb") as raw, zstandard.ZstdDecompressor().stream_reader(raw) as stream:
            with tarfile.open(fileobj=stream, mode="r|") as tar:
                # The release has a top-level directory; only model files are admitted.
                for member in tar:
                    if not member.isfile():
                        continue
                    name = pathlib.PurePosixPath(member.name).name
                    if name not in {"model.fermion", "config.json", "packed_manifest.json"}:
                        continue
                    source = tar.extractfile(member)
                    if source is not None:
                        with source, (model / name).open("wb") as out:
                            shutil.copyfileobj(source, out, 1024 * 1024)
    for name, expected in EXTRACTED_FILES.items():
        if not (model / name).is_file() or digest(model / name) != expected:
            raise RuntimeError(f"Extracted artifact verification failed: {name}")
    manifest = {
        "model": "FermionResearch/Phonon-2", "revision": REVISION,
        "runtime": "fermion-research==0.2.12", "weightsLicense": "CC-BY-4.0",
        "files": {p.name: {"sha256": digest(p), "bytes": p.stat().st_size}
                  for p in sorted(model.iterdir()) if p.is_file() and p.name != "manifest.json"},
    }
    (model / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Verified Phonon-2 model ready.", flush=True)


if __name__ == "__main__":
    main()
