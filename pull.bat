@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Pull TransactionRecord from GitHub
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

echo --- current state ---
git log --oneline -1
echo.
git status --short
echo.

echo --- git pull ---
rem --ff-only: refuse to create a surprise merge commit. If this fails,
rem it means the local folder has commits that GitHub does not - stop and look.
git pull --ff-only origin main
if errorlevel 1 (
  echo.
  echo [ERROR] pull failed.
  echo If it says "divergent branches" or "cannot fast-forward", your local
  echo folder has commits that are not on GitHub. Do NOT force anything -
  echo copy this whole window and ask Claude what to do.
  echo.
  pause
  exit /b 1
)

echo.
echo --- now at ---
git log --oneline -1
echo.

echo ============================================
echo   DONE. Tell Claude it finished, and the
echo   v1.8.1 files will be written next.
echo ============================================
echo.
pause
