$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$python = Join-Path $root 'resources/runtime/python/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run scripts/setup-speech.ps1 first.' }
& $python (Join-Path $root 'workers/speech/test_protocol.py')
if ($LASTEXITCODE -ne 0) { throw 'Speech protocol/concurrency checks failed.' }
& $python (Join-Path $root 'workers/speech/test_worker.py')
if ($LASTEXITCODE -ne 0) { throw 'Real speech integration checks failed.' }
