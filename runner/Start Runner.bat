@echo off
title Backlink Tool Runner
cd /d "%~dp0"
set "NODEDIR=%~dp0runtime\node"

rem ---- 1. Node.js: use the system one, or download a private copy into .\runtime\node ----
where node >nul 2>nul
if not errorlevel 1 goto havenode
if exist "%NODEDIR%\node.exe" goto usebundled

echo.
echo  Node.js not found. Downloading it into this folder (about 30 MB, one time only)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; $ProgressPreference='SilentlyContinue';" ^
  "$base='https://nodejs.org/dist/latest-v22.x/';" ^
  "$name=((Invoke-WebRequest -UseBasicParsing ($base+'SHASUMS256.txt')).Content -split '\r?\n' | Where-Object { $_ -match 'win-x64\.zip$' } | Select-Object -First 1).Split(' ')[-1].Trim();" ^
  "New-Item -ItemType Directory -Force -Path 'runtime' | Out-Null;" ^
  "Invoke-WebRequest -UseBasicParsing ($base+$name) -OutFile 'runtime\node.zip';" ^
  "Expand-Archive -Force 'runtime\node.zip' 'runtime';" ^
  "Remove-Item 'runtime\node.zip';" ^
  "$d=Get-ChildItem 'runtime' -Directory | Where-Object { $_.Name -like 'node-v*' } | Select-Object -First 1;" ^
  "if (Test-Path 'runtime\node') { Remove-Item -Recurse -Force 'runtime\node' };" ^
  "Rename-Item $d.FullName 'node'"
if not exist "%NODEDIR%\node.exe" (
  echo  Could not download Node.js. Check the internet connection and double-click this file again.
  pause
  exit /b
)

:usebundled
set "PATH=%NODEDIR%;%PATH%"

:havenode
rem ---- 2. Google Chrome (the runner drives the real Chrome) ----
set "HASCHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set HASCHROME=1
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set HASCHROME=1
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set HASCHROME=1
if not defined HASCHROME (
  echo.
  echo  Google Chrome is not installed. Opening the Chrome download page.
  echo  Install Chrome, then double-click this file again.
  start https://www.google.com/chrome/
  pause
  exit /b
)

rem ---- 3. Install the runner's packages (first start only) ----
if not exist "node_modules" (
  echo  First start: installing the runner. This takes about a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  Install failed. Check the internet connection and try again.
    pause
    exit /b
  )
)

rem ---- 4. Start ----
echo.
echo  KEEP THIS WINDOW OPEN while the team is running sites. Close it to stop the runner.
echo.
node runner.js
pause
