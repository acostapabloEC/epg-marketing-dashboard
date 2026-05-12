@echo off
:: EPG LinkedIn Scraper — Windows Task Scheduler Setup
:: Run this once as Administrator to register the Tuesday 5:30 PM task.
:: Double-click the file and click "Run as administrator" when prompted.

SET TASK_NAME=EPG_LinkedIn_Weekly_Report
SET SCRAPER_DIR=%~dp0
SET NODE_PATH=node

echo.
echo  Setting up EPG Weekly LinkedIn Report...
echo  Scraper directory: %SCRAPER_DIR%
echo.

:: Delete existing task if it exists (silent)
schtasks /Delete /TN "%TASK_NAME%" /F >nul 2>&1

:: Create the task: every Tuesday at 5:30 PM
schtasks /Create ^
  /TN "%TASK_NAME%" ^
  /TR "cmd /c \"cd /d %SCRAPER_DIR% && %NODE_PATH% index.js >> %SCRAPER_DIR%run.log 2>&1\"" ^
  /SC WEEKLY ^
  /D TUE ^
  /ST 17:30 ^
  /RL HIGHEST ^
  /F

IF %ERRORLEVEL% EQU 0 (
  echo.
  echo  SUCCESS! Task registered:
  echo    Name    : %TASK_NAME%
  echo    Schedule: Every Tuesday at 5:30 PM
  echo    Log file: %SCRAPER_DIR%run.log
  echo.
  echo  To test it right now, run:
  echo    schtasks /Run /TN "%TASK_NAME%"
  echo.
  echo  To view the task in Task Scheduler, open:
  echo    Task Scheduler ^> Task Scheduler Library ^> %TASK_NAME%
) ELSE (
  echo.
  echo  ERROR: Could not create task. Make sure you ran this as Administrator.
  echo  Right-click setup-schedule.bat and choose "Run as administrator".
)

echo.
pause
