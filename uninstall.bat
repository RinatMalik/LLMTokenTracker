@echo off
echo.
echo  ============================================
echo   Claude Token Tracker - Uninstaller
echo  ============================================
echo.

set CLAUDE_DIR=%USERPROFILE%\.claude

echo  Removing files...
del /f /q "%CLAUDE_DIR%\statusline-usage.js"  2>nul
del /f /q "%CLAUDE_DIR%\statusline-usage.sh"   2>nul
del /f /q "%CLAUDE_DIR%\usage-dashboard.js"   2>nul
del /f /q "%CLAUDE_DIR%\usage-dashboard.bat"  2>nul
del /f /q "%CLAUDE_DIR%\hooks\usage-notify.js"    2>nul
del /f /q "%CLAUDE_DIR%\hooks\usage-notify.sh"    2>nul
del /f /q "%CLAUDE_DIR%\hooks\usage-precheck.js"  2>nul
del /f /q "%CLAUDE_DIR%\hooks\usage-precheck.sh"  2>nul
del /f /q "%CLAUDE_DIR%\hooks\rate-limit-hit.sh"  2>nul
echo  [OK] Files removed

echo.
echo  Removing settings...
node "%~dp0scripts\remove-settings.js" "%CLAUDE_DIR%\settings.json"
if errorlevel 1 (
    echo  [WARN] Could not auto-remove settings.
    echo         Please manually remove the statusLine and hooks entries
    echo         from %CLAUDE_DIR%\settings.json
) else (
    echo  [OK] Settings cleaned up
)

echo.
echo  Your usage log has been kept at:
echo    %CLAUDE_DIR%\usage-log.jsonl
echo  Delete it manually if you no longer need it.
echo.
echo  Uninstall complete. Restart Claude Code to apply.
echo.
pause
