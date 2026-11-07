@echo off
REM Windows SDK 10.0.22621 on this machine is missing ucrt.lib (x64). Stub from libucrt.lib.
call "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%~dp0..\.link" mkdir "%~dp0..\.link"
if not exist "%~dp0..\.link\ucrt.lib" copy /Y "C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64\libucrt.lib" "%~dp0..\.link\ucrt.lib" >nul
if not exist "%~dp0..\.link\ucrtd.lib" copy /Y "C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64\libucrtd.lib" "%~dp0..\.link\ucrtd.lib" >nul
set LIB=%~dp0..\.link;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\ucrt\x64;C:\Program Files (x86)\Windows Kits\10\Lib\10.0.22621.0\um\x64;%LIB%
set INCLUDE=C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\ucrt;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\shared;C:\Program Files (x86)\Windows Kits\10\Include\10.0.22621.0\um;C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\14.42.34433\include;%INCLUDE%
cargo %*
