param([switch]$SkipDependencies, [switch]$SkipModel)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtime = Join-Path $root 'resources/runtime'
$pythonDir = Join-Path $runtime 'python'
$cache = Join-Path $runtime 'downloads'
New-Item -ItemType Directory -Force $pythonDir, $cache | Out-Null
$python = Join-Path $pythonDir 'python.exe'
$pythonArchive = Join-Path $cache 'python-3.12.10-embed-amd64.zip'
if (-not (Test-Path -LiteralPath $python)) {
    Write-Host 'Downloading embedded Python 3.12.10 (11 MB)...'
    Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $pythonArchive
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonDir -Force
}
# _pth keeps the interpreter independent from the user's Python/site configuration.
@('python312.zip', '.', 'Lib/site-packages', 'import site') | Set-Content -LiteralPath (Join-Path $pythonDir 'python312._pth') -Encoding ascii
if (-not $SkipDependencies) {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if (-not $uv) { throw 'Development setup needs uv (https://docs.astral.sh/uv/). The packaged app includes all dependencies and never needs uv or pip.' }
    Write-Host 'Installing pinned CPU speech dependencies into the embedded runtime...'
    $requirements = Join-Path $root 'workers/speech/requirements.lock.txt'
    if (-not (Test-Path -LiteralPath $requirements)) { $requirements = Join-Path $root 'workers/speech/requirements.txt' }
    & $uv.Source pip install --python $python --target (Join-Path $pythonDir 'Lib/site-packages') --requirements $requirements --link-mode copy
    if ($LASTEXITCODE -ne 0) { throw 'Speech dependency installation failed.' }
}
if (-not $SkipModel) {
    & $python (Join-Path $root 'workers/speech/setup_model.py') --root $root
    if ($LASTEXITCODE -ne 0) { throw 'Pinned Phonon-2 setup failed.' }
}
& $python (Join-Path $root 'workers/speech/runtime_manifest.py')
if ($LASTEXITCODE -ne 0) { throw 'Runtime manifest generation failed.' }
Write-Host 'Speech runtime ready:' $python
