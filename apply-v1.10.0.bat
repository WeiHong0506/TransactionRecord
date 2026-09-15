@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  记账本 v1.10.0：固定支出 + 和上月对比
echo ============================================================
echo.
echo  开始之前，先确认这两段 SQL 已经在 Supabase 跑过：
echo    1. supabase-budgets.sql      （v1.9.0 预算表）
echo    2. supabase-recurrings.sql   （v1.10.0 固定支出表）
echo.
echo  顺序不能反。先推代码的话，应用会往还不存在的表上传数据，
echo  同步会直接报错。
echo.
set /p ok="两段 SQL 都跑过了吗？跑过输入 y 回车，没跑过直接关掉窗口： "
if /i not "%ok%"=="y" goto abort

echo.
echo === 1/5 解压 v1.10.0，覆盖当前代码 ===
powershell -NoProfile -Command "Expand-Archive -Path 'v1.10.0-flat.zip' -DestinationPath '.' -Force"
if errorlevel 1 goto fail
del /q v1.10.0-flat.zip

echo.
echo === 2/5 安装依赖 ===
call npm install
if errorlevel 1 goto fail

echo.
echo === 3/5 构建 ===
call npm run build
if errorlevel 1 goto fail

echo.
echo === 4/5 提交 ===
git add -A
git diff --cached --quiet && (echo 没有需要提交的改动，跳过。& goto push)
git commit -m "v1.10.0: 固定支出与和上月对比" -m "" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_015GRyTnyQdeDfWtY674KbvT"
if errorlevel 1 goto fail

:push
echo.
echo === 5/5 推送 ===
git push
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  完成。GitHub Actions 会自动部署，一两分钟后刷新页面。
echo  手机上装的那个要从主屏幕重开一次才会拿到新版本。
echo  在「设置 - 关于」里应该看到 v1.10.0。
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ------------------------------------------------------------
echo  上一步出错了。先别继续，把上面的报错整段发我。
echo ------------------------------------------------------------
pause
exit /b 1

:abort
echo.
echo 已取消。先去 Supabase 跑 SQL，再回来双击这个文件。
pause
exit /b 1
