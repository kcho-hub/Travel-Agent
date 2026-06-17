@echo off
echo.
echo  Starting AI Travel Finder...
echo.

:: ── 1. Try the Windows Python Launcher (py.exe) ─────────────────────────────
::    Usually lives at C:\Windows\py.exe — always in PATH, no admin needed
where py >nul 2>nul
if %ERRORLEVEL% == 0 (
    echo  Found: py launcher
    py server.py
    goto end
)

:: ── 2. Try python / python3 on PATH ─────────────────────────────────────────
where python >nul 2>nul
if %ERRORLEVEL% == 0 (
    echo  Found: python on PATH
    python server.py
    goto end
)

where python3 >nul 2>nul
if %ERRORLEVEL% == 0 (
    echo  Found: python3 on PATH
    python3 server.py
    goto end
)

:: ── 3. Try Node.js ───────────────────────────────────────────────────────────
where node >nul 2>nul
if %ERRORLEVEL% == 0 (
    echo  Found: node
    node server.js
    goto end
)

:: ── 4. Search common Python install locations ────────────────────────────────
echo  Searching for Python in common locations...

for %%V in (313 312 311 310 39 38) do (
    if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" (
        echo  Found: %LOCALAPPDATA%\Programs\Python\Python%%V\python.exe
        "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" server.py
        goto end
    )
    if exist "C:\Python%%V\python.exe" (
        echo  Found: C:\Python%%V\python.exe
        "C:\Python%%V\python.exe" server.py
        goto end
    )
    if exist "C:\Program Files\Python%%V\python.exe" (
        echo  Found: C:\Program Files\Python%%V\python.exe
        "C:\Program Files\Python%%V\python.exe" server.py
        goto end
    )
)

:: ── 5. Try Microsoft Store Python location ───────────────────────────────────
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" (
    echo  Found: Microsoft Store Python
    "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" server.py
    goto end
)

:: ── Nothing found ─────────────────────────────────────────────────────────────
echo.
echo  Could not find Python or Node.js automatically.
echo.
echo  To locate Python manually, open a new cmd window and run:
echo.
echo     dir /s /b "%USERPROFILE%\python.exe" 2^>nul
echo     dir /s /b "C:\python.exe" 2^>nul
echo.
echo  Then open start.bat in Notepad and replace the last section
echo  with the full path found above, e.g.:
echo.
echo     "C:\full\path\to\python.exe" server.py
echo.

:end
pause
