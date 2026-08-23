@echo off
rem Double-click launcher for the DocSend Capture dashboard (Windows).
rem
rem No terminal typing required: double-click this file and the dashboard opens
rem in your browser. The console window that appears IS the server, so leave it
rem open while you work and close it when you are done.
rem
rem Keep this file pure ASCII. Batch files are read as ANSI, so a UTF-8 dash or
rem curly quote arrives as mojibake and can break parsing.

setlocal
title DocSend Capture

set "PY=%USERPROFILE%\.docsend-capture\venv\Scripts\python.exe"
set "DASH=%USERPROFILE%\.claude\skills\docsend-dataroom-capture\scripts\dashboard.py"
set "DESKTOP_COPY=%USERPROFILE%\Desktop\DocSend-Capture.cmd"

if not exist "%PY%" (
  echo.
  echo Python environment not found at:
  echo   %PY%
  echo.
  echo Run the one-time setup first:
  echo   powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\docsend-dataroom-capture\scripts\setup.ps1"
  echo.
  pause
  exit /b 1
)

if not exist "%DASH%" (
  echo.
  echo Dashboard not found at:
  echo   %DASH%
  echo.
  echo The skill files are missing or in another folder.
  echo.
  pause
  exit /b 1
)

rem Leave a copy on the Desktop so there is a permanent icon to click next time.
if not exist "%DESKTOP_COPY%" (
  copy /y "%~f0" "%DESKTOP_COPY%" >nul 2>&1
  if exist "%DESKTOP_COPY%" echo Added "DocSend-Capture" to your Desktop for next time.
)

echo.
echo Starting the DocSend Capture dashboard...
echo Your browser should open at http://127.0.0.1:8765/
echo.
echo Keep this window open while you use the dashboard.
echo Close it (or press Ctrl+C) to stop the server.
echo.

"%PY%" "%DASH%" --port 8765

echo.
echo The dashboard has stopped.
pause
