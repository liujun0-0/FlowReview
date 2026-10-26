@echo off
setlocal
pushd "%~dp0"
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto failed
call npm.cmd run build
if errorlevel 1 goto failed
echo Ready. Drag review.json onto open-review.cmd to read.
popd
pause
exit /b 0
:failed
echo Setup failed. See the error above.
popd
pause
exit /b 1
