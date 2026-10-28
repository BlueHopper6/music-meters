param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
# This test changes Start menu and uninstall registration. Never run it on a
# developer's account; use a disposable GitHub-hosted Windows runner only.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'Installer lifecycle test requires a disposable GitHub-hosted Windows runner.'
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot = [IO.Path]::GetFullPath($Output)
if (-not $testRoot.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Choose a fresh output directory inside the checkout.'
}
if (Test-Path -LiteralPath $testRoot) { throw 'Test output already exists.' }
$setup = (Resolve-Path -LiteralPath $Installer).Path
$programs = [Environment]::GetFolderPath('Programs')
$shortcut = Join-Path $programs 'MusicMeters.lnk'
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'music-visualizer'
$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Find-Registration {
  @(Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue |
    Get-ItemProperty | Where-Object { $_.DisplayName -eq 'MusicMeters' })
}
if ((Test-Path -LiteralPath $shortcut) -or (Test-Path -LiteralPath $profile) -or (Find-Registration).Count) {
  throw 'Disposable account already has MusicMeters data or registration; refusing to replace it.'
}
New-Item -ItemType Directory -Path $testRoot,$profile | Out-Null
$marker = Join-Path $profile 'installer-preservation-test.txt'
[IO.File]::WriteAllText($marker, 'preserve across reinstall and uninstall')
function Run-Setup {
  $process = Start-Process -FilePath $setup -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Setup failed: $($process.ExitCode)" }
}
Run-Setup
$registration = Find-Registration
if ($registration.Count -ne 1) { throw 'Expected one per-user uninstall registration.' }
$uninstallMatch = [regex]::Match($registration[0].UninstallString, '^"([^"]+)"')
if (-not $uninstallMatch.Success) { throw 'Unexpected uninstall registration command.' }
$installDir = Split-Path -LiteralPath $uninstallMatch.Groups[1].Value
$localPrograms = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'
if (-not ([IO.Path]::GetFullPath($installDir)).StartsWith($localPrograms + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Unexpected installation location; refusing to run uninstaller.'
}
$appExe = Join-Path $installDir 'MusicMeters.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw 'Branded executable not installed.' }
if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Start menu shortcut missing.' }
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
if ($link.TargetPath -ne $appExe) { throw 'Start menu shortcut targets the wrong executable.' }
node (Join-Path $repo 'phase6/test/package-branding.cjs') $installDir
node (Join-Path $repo 'phase6/test/package-smoke.cjs') $installDir (Join-Path $testRoot 'installed-export')
node (Join-Path $repo 'phase2/test/run-startup-smoke.cjs') --package $installDir
Run-Setup
if (-not (Test-Path -LiteralPath $marker)) { throw 'Reinstall removed existing profile data.' }
$uninstaller = Join-Path $installDir 'Uninstall MusicMeters.exe'
if (-not (Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing.' }
$process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ((Test-Path -LiteralPath $appExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
if ((Test-Path -LiteralPath $appExe) -or (Test-Path -LiteralPath $shortcut) -or (Find-Registration).Count) {
  throw 'Uninstall left application files, shortcut, or registration behind.'
}
if ([IO.File]::ReadAllText($marker) -ne 'preserve across reinstall and uninstall') {
  throw 'Uninstall did not preserve profile data.'
}
@{ status = 'PASS'; install = $true; shortcutTarget = $true; installedExport = $true;
   reinstall = $true; uninstall = $true; profilePreserved = $true } |
  ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'result.json')
