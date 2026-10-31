<#
.SYNOPSIS
  Builds a self-contained, single-file PrintShare Bridge for Windows (no .NET install needed on the target PC)
  and copies the zip to web/public/downloads so the dashboard offers it for download.

.EXAMPLE
  ./publish.ps1                 # win-x64 Release
  ./publish.ps1 -Runtime win-x86
#>
param(
    [string]$Configuration = "Release",
    [ValidateSet("win-x64", "win-x86", "win-arm64")][string]$Runtime = "win-x64",
    [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
# Works in Windows PowerShell 5.1 and PowerShell 7.
$cmd = Get-Command dotnet -ErrorAction SilentlyContinue
$dotnet = if ($cmd) { $cmd.Source } else { Join-Path $env:LOCALAPPDATA "Microsoft\dotnet\dotnet.exe" }
if (-not (Test-Path $dotnet)) { throw "The .NET 8 SDK is required. Install it from https://dotnet.microsoft.com/download/dotnet/8.0" }

if (-not $SkipTests) {
    & $dotnet test (Join-Path $root "PrintShare.Bridge.sln") -c $Configuration
    if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
}

$name = "PrintShareBridge-$Runtime"
$out = Join-Path $root "artifacts\$name"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

& $dotnet publish (Join-Path $root "src\PrintShare.Bridge.App\PrintShare.Bridge.App.csproj") `
    -c $Configuration -r $Runtime --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none -o $out
if ($LASTEXITCODE -ne 0) { throw "Publish failed" }

Copy-Item (Join-Path $root "README.md") (Join-Path $out "README.md")
$zip = Join-Path $root "artifacts\$name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip

$downloads = Join-Path $root "..\web\public\downloads"
New-Item -ItemType Directory -Force $downloads | Out-Null
Copy-Item $zip (Join-Path $downloads "$name.zip") -Force

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Built $zip"
Write-Host "SHA-256 $hash"
Write-Host "Copied to web/public/downloads/$name.zip (offered on the Printers page)"
