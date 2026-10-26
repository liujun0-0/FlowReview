@echo off
setlocal
if "%~1"=="" (
  node "%~dp0bin\flowreview.js" --help
  pause
  exit /b
)
if "%~x1"==".json" (
  node "%~dp0bin\flowreview.js" --review "%~f1"
  if errorlevel 1 pause
  exit /b
)
:flags
node "%~dp0bin\flowreview.js" %*
if errorlevel 1 pause
