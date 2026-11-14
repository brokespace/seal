@echo off
REM `seal` is Seal's own command name; orca.cmd beside it keeps the upstream alias.
call "%~dp0orca.cmd" %*
exit /b %ERRORLEVEL%
