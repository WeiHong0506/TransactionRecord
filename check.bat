@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  推送状态自检
echo ============================================================
echo.

for /f "tokens=2 delims='" %%v in ('findstr "APP_VERSION" src\components\Settings.jsx') do set "ver=%%v"
echo  本地代码版本   : %ver%
echo.

echo  --- 有没有还没提交的改动 ---
git status --short
if not errorlevel 1 echo  (上面是空的就表示没有未提交的改动)
echo.

echo  --- 本地和 GitHub 是否一致 ---
git fetch origin main >nul 2>nul
for /f %%a in ('git rev-parse --short HEAD') do set "loc=%%a"
for /f %%b in ('git rev-parse --short origin/main') do set "rem=%%b"
echo  本地 HEAD      : %loc%
echo  GitHub main    : %rem%
echo.

if "%loc%"=="%rem%" (
  echo  ✓ 一致，代码已经推上去了。
  echo.
  echo    线上部署要等 GitHub Actions 跑完，一两分钟。
  echo    确认方法：打开网页 - 设置 - 关于，版本号应该是 %ver%
  echo    手机上的要从主屏幕重开一次才会拿到新版。
) else (
  echo  ✗ 不一致，还有东西没推上去。
  echo    跑一下 push.bat，把报错整段发我。
)

echo.
echo ============================================================
pause
