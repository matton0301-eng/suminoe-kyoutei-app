@echo off
rem 番組表を取得してアプリを更新・デプロイする（Windows タスクスケジューラから呼ぶ用）。
rem
rem   refresh-and-deploy.cmd              当日分
rem   refresh-and-deploy.cmd 2026-08-09   日付を指定
rem
rem 中身は refresh-and-deploy.sh（冪等）。すでに同じ日付が入っていれば何もしない。

setlocal
cd /d "%~dp0"

set "GITBASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"

if not exist "%GITBASH%" (
  echo [ERROR] Git Bash が見つかりません。bash.exe のパスを確認してください。
  exit /b 1
)

"%GITBASH%" refresh-and-deploy.sh %*
exit /b %ERRORLEVEL%
