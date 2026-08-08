@echo off
rem 競走成績を取得して照合し、アプリに反映・デプロイする（タスクスケジューラから呼ぶ用）。
rem
rem   review-and-deploy.cmd              当日分
rem   review-and-deploy.cmd 2026-08-09   日付を指定
rem
rem 中身は review-and-deploy.sh（冪等）。成績が未確定なら何もしない。

setlocal
cd /d "%~dp0"

set "GITBASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if not exist "%GITBASH%" (
  echo [ERROR] Git Bash が見つかりません。
  exit /b 1
)

"%GITBASH%" review-and-deploy.sh %*
exit /b %ERRORLEVEL%
