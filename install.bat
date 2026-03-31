@echo off
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   Claude Token Tracker - Installer
echo  ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found. Please install from https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found

:: Check Claude Code settings file
set CLAUDE_DIR=%USERPROFILE%\.claude
set SETTINGS=%CLAUDE_DIR%\settings.json

if not exist "%CLAUDE_DIR%" (
    echo  [ERROR] Claude Code not found at %CLAUDE_DIR%
    echo         Please install Claude Code first: https://claude.ai/download
    pause
    exit /b 1
)
echo  [OK] Claude Code directory found

:: Create hooks directory
if not exist "%CLAUDE_DIR%\hooks" mkdir "%CLAUDE_DIR%\hooks"
echo  [OK] Hooks directory ready

:: Copy source files
echo.
echo  Copying files...
copy /Y "src\statusline-usage.js" "%CLAUDE_DIR%\statusline-usage.js" >nul
copy /Y "src\statusline-usage.sh"  "%CLAUDE_DIR%\statusline-usage.sh"  >nul
copy /Y "src\usage-dashboard.js"  "%CLAUDE_DIR%\usage-dashboard.js"  >nul
copy /Y "src\usage-dashboard.bat" "%CLAUDE_DIR%\usage-dashboard.bat" >nul
copy /Y "src\hooks\usage-notify.js"    "%CLAUDE_DIR%\hooks\usage-notify.js"    >nul
copy /Y "src\hooks\usage-notify.sh"    "%CLAUDE_DIR%\hooks\usage-notify.sh"    >nul
copy /Y "src\hooks\usage-precheck.js"  "%CLAUDE_DIR%\hooks\usage-precheck.js"  >nul
copy /Y "src\hooks\usage-precheck.sh"  "%CLAUDE_DIR%\hooks\usage-precheck.sh"  >nul
copy /Y "src\hooks\rate-limit-hit.sh"  "%CLAUDE_DIR%\hooks\rate-limit-hit.sh"  >nul
echo  [OK] Source files copied

:: Merge settings.json
echo.
echo  Updating Claude Code settings...
node "%~dp0scripts\merge-settings.js" "%SETTINGS%"
if errorlevel 1 (
    echo  [WARN] Could not auto-merge settings.json
    echo         Please manually add the contents of src\settings-snippet.json
    echo         into %SETTINGS%
) else (
    echo  [OK] settings.json updated
)

echo.
echo  ============================================
echo   Installation complete!
echo  ============================================
echo.
echo  Restart Claude Code to activate the tracker.
echo.
echo  To view your dashboard:
echo    "%USERPROFILE%\.claude\usage-dashboard.bat"
echo    "%USERPROFILE%\.claude\usage-dashboard.bat" --gui
echo.
pause
