@echo off
:: STEP 2 — double-click ONLY after the preview looks right.
:: This emails John the table, DMs it to him on Teams, and logs the week.
SET DIR=%~dp0
SET PYTHON=C:\Python314\python.exe
SET ECP_EMAIL_PASS=Datamagic26$
:: Paste your Power Automate URL here to turn on the Teams DM (uncomment the line):
:: SET JOHN_TEAMS_FLOW_URL=https://prod-XX.logic.azure.com:443/workflows/...
"%PYTHON%" "%DIR%send_john_report.py" --send %*
echo.
pause
