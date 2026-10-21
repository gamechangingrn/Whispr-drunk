param(
    [switch]$RepairLocalDependencies,
    [string]$PythonDirectory
)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $PythonDirectory) { $PythonDirectory = Join-Path $taskRoot 'resources\runtime\python' }
$taskPythonFolder = [IO.Path]::GetFullPath($PythonDirectory)
$taskPythonExe = Join-Path $taskPythonFolder 'python.exe'
if (-not (Test-Path -LiteralPath $taskPythonExe)) { throw 'Embedded Python is missing. Run scripts/setup-speech.ps1 first, or provide -PythonDirectory for a packaged runtime.' }
if ([IntPtr]::Size -ne 8) { throw 'Use 64-bit PowerShell for the x64 runtime check.' }

# These are release Visual C++ runtime libraries, not Windows API/debug DLLs.
# App-local deployment is supported by Microsoft, subject to its redistribution
# license. This switch is explicit because it changes the runtime payload.
$taskRuntimeNames = @('msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','msvcp140_atomic_wait.dll','msvcp140_codecvt_ids.dll','concrt140.dll')
$taskRecords = @()
foreach ($taskName in $taskRuntimeNames) {
    $taskDestination = Join-Path $taskPythonFolder $taskName
    $taskSource = Join-Path ([Environment]::GetFolderPath('System')) $taskName
    $taskCopied = $false
    if (-not (Test-Path -LiteralPath $taskDestination) -and $RepairLocalDependencies) {
        if (-not (Test-Path -LiteralPath $taskSource)) { throw "The installed x64 Visual C++ runtime lacks $taskName. Install the official Microsoft x64 redistributable, then retry." }
        $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskSource
        if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'Microsoft') { throw "Refusing unverified runtime file: $taskName" }
        Copy-Item -LiteralPath $taskSource -Destination $taskDestination
        $taskCopied = $true
    }
    if (Test-Path -LiteralPath $taskDestination) {
        $taskFile = Get-Item -LiteralPath $taskDestination
        $taskRecords += [ordered]@{file=$taskName;fileVersion=$taskFile.VersionInfo.FileVersion;bytes=$taskFile.Length;sha256=(Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash.ToLowerInvariant();source=$taskSource;copiedThisRun=$taskCopied}
    }
}
if ($RepairLocalDependencies) {
    $taskManifest = [ordered]@{
        schema=1; createdUtc=[DateTime]::UtcNow.ToString('o'); purpose='App-local x64 release Visual C++ runtime dependencies for embedded Python / PyTorch';
        deploymentDocumentation='https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files';
        licenseDocumentation='https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution';
        licenseNote='Microsoft proprietary redistributable files, unchanged. Redistribution remains subject to the publisher applicable Microsoft license; this manifest records provenance, not a license grant.';
        files=$taskRecords
    }
    $taskManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskPythonFolder 'app-local-dependencies.json') -Encoding UTF8
}
$taskProbe = @'
import ctypes, importlib.metadata, json, pathlib, platform, sys
root = pathlib.Path(sys.executable).parent
local = root / 'msvcp140.dll'
loaded = None
if local.exists():
    handle = ctypes.WinDLL(str(local))
    buffer = ctypes.create_unicode_buffer(32768)
    ctypes.windll.kernel32.GetModuleFileNameW(ctypes.c_void_p(handle._handle), buffer, len(buffer))
    loaded = buffer.value
import torch
import fermion
print(json.dumps({'python': platform.python_version(), 'architecture': platform.machine(), 'torch': torch.__version__, 'fermion': importlib.metadata.version('fermion-research'), 'torchImport': True, 'fermionImport': True, 'cpuTorch': torch.version.cuda is None, 'appLocalMsvcpLoaded': loaded is not None and pathlib.Path(loaded).resolve() == local.resolve()}))
'@
$taskEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskProbe))
$taskStart = New-Object Diagnostics.ProcessStartInfo
$taskStart.FileName = $taskPythonExe
$taskStart.Arguments = '-I -c "import base64; exec(base64.b64decode(''' + $taskEncoded + '''))"'
$taskStart.UseShellExecute = $false
$taskStart.CreateNoWindow = $true
$taskStart.RedirectStandardOutput = $true
$taskStart.RedirectStandardError = $true
$taskStart.EnvironmentVariables['HF_HUB_OFFLINE'] = '1'
$taskStart.EnvironmentVariables['TRANSFORMERS_OFFLINE'] = '1'
$taskStart.EnvironmentVariables['HF_HUB_DISABLE_TELEMETRY'] = '1'
$taskProcess = New-Object Diagnostics.Process
$taskProcess.StartInfo = $taskStart
[void]$taskProcess.Start()
$taskStdout = $taskProcess.StandardOutput.ReadToEnd()
$taskStderr = $taskProcess.StandardError.ReadToEnd()
if (-not $taskProcess.WaitForExit(60000)) { $taskProcess.Kill(); throw 'Runtime import check exceeded 60 seconds.' }
if ($taskProcess.ExitCode -ne 0) { throw "Embedded runtime import failed. Check Visual C++ dependencies or retry speech setup.`n$taskStderr" }
$taskProbeResult = $taskStdout.Trim() | ConvertFrom-Json
$taskPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
[ordered]@{passed=$true;pythonDirectory=$taskPythonFolder;administrator=$taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);repairRequested=[bool]$RepairLocalDependencies;localRuntimeFiles=$taskRecords;imports=$taskProbeResult;scope='Current-machine offline import and app-local DLL check; not a clean-VM compatibility test.'} | ConvertTo-Json -Depth 7
