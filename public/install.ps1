# Backlink Tool runner installer for Windows.
# Run the one-line command from the dashboard's Runner setup tab in PowerShell:
#   & ([scriptblock]::Create((irm https://<dashboard>/install.ps1))) -Server https://<dashboard> -Token <runner token>
# Everything is downloaded by PowerShell instead of the browser, so no file carries the "downloaded from the
# internet" mark that makes Windows Smart App Control / SmartScreen block Start Runner.bat.
# Installs into %LOCALAPPDATA%\BacklinkRunner, adds a "Backlink Runner" desktop shortcut and starts the runner.
# Running it again updates the runner and keeps its Chrome profile (saved logins on the directory sites).
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Name = $env:COMPUTERNAME,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'BacklinkRunner'),
  [switch]$NoShortcut,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Server = $Server.TrimEnd('/')
function Step($text) { Write-Host "  > $text" -ForegroundColor Cyan }

Write-Host ''
Write-Host '  Backlink Tool runner setup' -ForegroundColor White
Write-Host "  Dashboard: $Server"
Write-Host ''

# 1. Google Chrome: the runner drives the real Chrome so a person can solve CAPTCHAs in it.
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Host '  Google Chrome is not installed. Opening the download page: install Chrome, then run this command again.' -ForegroundColor Yellow
  Start-Process 'https://www.google.com/chrome/'
  return
}

# 2. Node.js: use the one on the PC, or a private copy in the install folder.
New-Item -ItemType Directory -Force $InstallDir | Out-Null
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $node = Join-Path $InstallDir 'node\node.exe'
  if (-not (Test-Path $node)) {
    Step 'Downloading Node.js (about 30 MB, first time only)'
    $base = 'https://nodejs.org/dist/latest-v22.x/'
    $zipName = ((Invoke-WebRequest -UseBasicParsing ($base + 'SHASUMS256.txt')).Content -split '\r?\n' |
      Where-Object { $_ -match 'win-x64\.zip$' } | Select-Object -First 1).Split(' ')[-1].Trim()
    $nodeZip = Join-Path $env:TEMP $zipName
    Invoke-WebRequest -UseBasicParsing ($base + $zipName) -OutFile $nodeZip
    $unpack = Join-Path $env:TEMP 'backlink-node-unpack'
    if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
    Expand-Archive $nodeZip $unpack -Force
    $nodeHome = Join-Path $InstallDir 'node'
    if (Test-Path $nodeHome) { Remove-Item $nodeHome -Recurse -Force }
    Move-Item (Get-ChildItem $unpack -Directory | Select-Object -First 1).FullName $nodeHome
    Remove-Item $nodeZip, $unpack -Recurse -Force
  }
}
$npm = Join-Path (Split-Path $node) 'node_modules\npm\bin\npm-cli.js'

# 3. The runner itself, from this dashboard (so it always matches the website's version).
Step 'Downloading the runner'
$runnerZip = Join-Path $env:TEMP 'backlink-runner.zip'
Invoke-WebRequest -UseBasicParsing "$Server/backlink-runner.zip" -OutFile $runnerZip
$unpack = Join-Path $env:TEMP 'backlink-runner-unpack'
if (Test-Path $unpack) { Remove-Item $unpack -Recurse -Force }
Expand-Archive $runnerZip $unpack -Force
Copy-Item (Join-Path $unpack 'backlink-runner\runner.js'), (Join-Path $unpack 'backlink-runner\package.json') $InstallDir -Force
Remove-Item $runnerZip, $unpack -Recurse -Force

Step 'Installing (about a minute the first time)'
Push-Location $InstallDir
try {
  & $node $npm install --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed. Check the internet connection and run the command again.' }
} finally { Pop-Location }

# 4. Connection to the dashboard (replaces any earlier one, so a new token takes effect).
$config = [ordered]@{ server = $Server; token = $Token; name = $Name } | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $InstallDir 'config.json'), $config, (New-Object Text.UTF8Encoding($false)))

# 5. Desktop shortcut. It starts Windows' own cmd.exe with node.exe, so no script file is involved.
$launchArgs = "/k title Backlink Tool Runner & `"$node`" runner.js"
if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Backlink Runner.lnk'))
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $lnk.Arguments = $launchArgs
  $lnk.WorkingDirectory = $InstallDir
  $lnk.IconLocation = "$chrome,0"
  $lnk.Description = 'Backlink Tool runner: keep this window open while the team runs sites'
  $lnk.Save()
  Step 'Added the "Backlink Runner" shortcut to the desktop'
}

Write-Host ''
Write-Host "  Installed in $InstallDir" -ForegroundColor Green
if (-not $NoStart) {
  Start-Process (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList $launchArgs -WorkingDirectory $InstallDir
  Write-Host '  The runner is starting in a new window. Keep that window open while the team runs sites.' -ForegroundColor Green
  Write-Host '  Next time, double-click "Backlink Runner" on the desktop.'
}
Write-Host ''
