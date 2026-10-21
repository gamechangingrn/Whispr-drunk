"""Record the exact installed runtime and distributable artifact digests."""
import hashlib
import importlib.metadata
import json
import pathlib
import platform

root = pathlib.Path(__file__).resolve().parents[2]
runtime = root / "resources/runtime"
archive = runtime / "downloads/python-3.12.10-embed-amd64.zip"
distributions = sorted([
    {"name": d.metadata["Name"], "version": d.version,
     "license": d.metadata.get("License-Expression", d.metadata.get("License", ""))}
    for d in importlib.metadata.distributions()], key=lambda item: item["name"].lower())
native = {}
for path in (runtime / "python/Lib/site-packages/fermion").rglob("*.dll"):
    native[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
manifest = {"pythonVersion": platform.python_version(),
            "pythonSource": "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
            "pythonArchiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest() if archive.exists() else None,
            "dependencies": distributions, "fermionNativeLibraries": native}
(runtime / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
