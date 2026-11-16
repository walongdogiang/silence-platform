@echo off
REM Run cargo with the MSVC toolchain environment (link.exe, Windows SDK libs) loaded.
REM Finds Visual Studio / Build Tools with vswhere and lets vcvars64 pick the newest complete
REM Windows SDK, so nothing is pinned to one VS edition or SDK version.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo [cargo-msvc] vswhere.exe not found. Install Visual Studio 2022 or Build Tools with "Desktop development with C++". 1>&2
  exit /b 1
)
set "VSROOT="
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
if not defined VSROOT (
  echo [cargo-msvc] No Visual Studio with the C++ x64 build tools. Add "Desktop development with C++" in Visual Studio Installer. 1>&2
  exit /b 1
)
REM VsDevCmd calls vswhere.exe by name; without the Installer folder on PATH it prints a harmless
REM "'vswhere.exe' is not recognized" on every run.
set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cargo %*
