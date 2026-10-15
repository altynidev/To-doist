@echo off
title To-doist
cd /d "%~dp0"
echo Starting To-doist...
java src\Main.java %*
if errorlevel 1 (
  echo.
  echo To-doist stopped with an error. Make sure Java 21+ is installed.
  pause
)
