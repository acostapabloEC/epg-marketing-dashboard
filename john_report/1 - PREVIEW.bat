@echo off
:: STEP 1 — double-click to see John's table on screen. Sends nothing.
SET DIR=%~dp0
SET PYTHON=C:\Python314\python.exe
SET ECP_EMAIL_PASS=Datamagic26$
"%PYTHON%" "%DIR%send_john_report.py" %*
echo.
echo Review the preview that just opened. If it looks good, double-click "2 - SEND TO JOHN".
echo.
pause
