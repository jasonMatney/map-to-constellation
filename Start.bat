@echo off
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 start.py
  goto :done
)
where python >nul 2>nul
if not errorlevel 1 (
  python start.py
  goto :done
)
where node >nul 2>nul
if not errorlevel 1 (
  start "" http://localhost:8787
  node server.cjs
  goto :done
)
echo This launcher needs Python 3 or Node.js. Neither was found.
echo See README.md for details.
:done
pause
