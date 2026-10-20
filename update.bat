@echo off
rem LODESTAR update: download latest main from GitHub, keep .env and pgdata, rebuild. Logic is in update.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" & exit /b
