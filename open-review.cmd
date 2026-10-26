@echo off
setlocal
if "%~1"=="" (
  node "%~dp0bin\yadiff-review.js" --help
  pause
  exit /b
)
if "%~x1"==".json" (
  node "%~dp0bin\yadiff-review.js" --review "%~f1"
  if errorlevel 1 pause
  exit /b
)
:flags
node "%~dp0bin\yadiff-review.js" %*
if errorlevel 1 pause
