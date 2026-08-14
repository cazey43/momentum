# ---------------------------------------------------------------------------
# Momentum launcher
#
# One click: make sure the app is running, then open it in the browser.
#   - If a server is already answering on :3000, just open the browser.
#   - Otherwise build if the source has changed since the last build, start the
#     production server (minimized), wait for it, then open the browser.
#
# Wired to the Desktop "Momentum" shortcut. Safe to run repeatedly — a second
# click on an already-running app simply reopens the tab.
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'SilentlyContinue'
$Project = 'E:\AI Chat Bot'
$Url = 'http://localhost:3000'

function Test-MomentumUp {
    try {
        return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-MomentumUp)) {
    # Rebuild only when needed: no build yet, or a source file is newer than it.
    $buildId = Join-Path $Project '.next\BUILD_ID'
    $needsBuild = $true
    if (Test-Path $buildId) {
        $builtAt = (Get-Item $buildId).LastWriteTime
        $newestSrc = Get-ChildItem -Path (Join-Path $Project 'src') -Recurse -File |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        $needsBuild = ($null -eq $newestSrc) -or ($newestSrc.LastWriteTime -gt $builtAt)
    }

    if ($needsBuild) {
        Start-Process -FilePath 'cmd.exe' `
            -ArgumentList '/c', 'title Building Momentum... & npm run build' `
            -WorkingDirectory $Project -WindowStyle Minimized -Wait
    }

    # Start the server and leave it running (minimized). Close its window to stop.
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/k', 'title Momentum server (close to stop) & npm run start' `
        -WorkingDirectory $Project -WindowStyle Minimized

    # Wait up to two minutes for it to answer.
    for ($i = 0; $i -lt 120; $i++) {
        if (Test-MomentumUp) { break }
        Start-Sleep -Seconds 1
    }
}

Start-Process $Url
