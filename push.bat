@echo off
cd /d "%~dp0"

echo ============================================
echo   Push TransactionRecord to GitHub
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERROR] git not found in PATH.
  echo Install Git for Windows: https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)

set "msg=%~1"
if "%msg%"=="" set /p msg=Commit message (press Enter for default):
if "%msg%"=="" set "msg=update"

echo.
echo --- git add ---
git add -A

echo.
echo --- git commit ---
git commit -m "%msg%"
if errorlevel 1 echo (nothing new to commit - continuing to push anyway)

echo.
echo --- git push ---
git push -u origin main
if errorlevel 1 (
  echo.
  echo [ERROR] push failed. Read the message above.
  echo Common causes: not logged in to GitHub, or remote has newer commits.
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   DONE. Check Actions tab on GitHub:
echo   https://github.com/WeiHong0506/TransactionRecord/actions
echo ============================================
echo.
pause
