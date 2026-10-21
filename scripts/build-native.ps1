param([switch]$Release)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskSource = Join-Path $taskRoot 'native\windows\Willfull.Native.cs'
$taskBin = Join-Path $taskRoot 'native\windows\bin'
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$taskFramework = Split-Path -Parent $taskCompiler
if (-not (Test-Path -LiteralPath $taskCompiler)) { throw '.NET Framework 4.x x64 compiler is required for the native helper build.' }
New-Item -ItemType Directory -Path $taskBin -Force | Out-Null
$taskOutput = Join-Path $taskBin 'Willfull.Native.exe'
& $taskCompiler /nologo /target:exe /platform:x64 /optimize+ /debug:pdbonly "/out:$taskOutput" /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/reference:$taskFramework\WPF\UIAutomationClient.dll" "/reference:$taskFramework\WPF\UIAutomationTypes.dll" "/reference:$taskFramework\WPF\WindowsBase.dll" $taskSource
if ($LASTEXITCODE -ne 0) { throw "Native helper compilation failed: $LASTEXITCODE" }
Write-Output $taskOutput
