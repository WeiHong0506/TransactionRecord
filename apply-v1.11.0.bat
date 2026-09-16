@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo  记账本 v1.11.0：收据截图导入
echo ============================================================
echo.
echo  这一版不需要跑任何 SQL——收据识别全在本机，没有新的云端表。
echo.
echo  包里多了 public\ocr\（约 14MB 的识别模型）。
echo  它们自己托管在你的站点上，不走第三方 CDN，所以一个请求都不会
echo  发给外部服务。第一次推送会比平时慢一点，之后就不动了。
echo.
set /p ok="开始吗？输入 y 回车： "
if /i not "%ok%"=="y" goto abort

echo.
echo === 1/4 解压 v1.11.0，覆盖当前代码 ===
powershell -NoProfile -Command "Expand-Archive -Path 'v1.11.0-flat.zip' -DestinationPath '.' -Force"
if errorlevel 1 goto fail
del /q v1.11.0-flat.zip

echo.
echo === 2/4 提交 ===
git add -A
git diff --cached --quiet && (echo 没有需要提交的改动，跳过。& goto push)
git commit -m "v1.11.0: 收据截图导入（粘贴文字 + 本机 OCR）" -m "" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_015GRyTnyQdeDfWtY674KbvT"
if errorlevel 1 goto fail

:push
echo.
echo === 3/4 推送（这次要传 14MB，慢一点是正常的）===
git push
if errorlevel 1 goto fail

echo.
echo === 4/4 完成 ===
echo.
echo ============================================================
echo  GitHub Actions 会自动构建部署，一两分钟后刷新页面。
echo  手机上装的那个要从主屏幕重开一次才会拿到新版本。
echo  在「设置 - 关于」里应该看到 v1.11.0。
echo.
echo  用法：设置 - 导入收据截图
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
echo 已取消。
pause
exit /b 1
