@echo off
rem 直前情報（展示タイム）を取得してアプリに反映・デプロイする（タスクスケジューラから呼ぶ用）。
rem
rem   tenji-and-deploy.cmd              当日分
rem   tenji-and-deploy.cmd 2026-08-09   日付を指定
rem
rem 中身は tenji-and-deploy.sh（冪等）。前回と中身が同じならデプロイしない。

setlocal
cd /d "%~dp0"

set "GITBASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if not exist "%GITBASH%" (
  echo [ERROR] Git Bash が見つかりません。
  exit /b 1
)

"%GITBASH%" tenji-and-deploy.sh %*
exit /b %ERRORLEVEL%
