@echo off
title Baja75 Scoring Management System
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
