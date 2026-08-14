<#
.SYNOPSIS
  Speaks a short status line aloud (Windows System.Speech, SAPI fallback).

.DESCRIPTION
  Reusable speech engine for Claude Code notification hooks. Safe by design:
  - Honors a mute switch (env CLAUDE_SPEAK_MUTE=1 or a .speak-muted file).
  - Sanitizes and length-caps the message.
  - Suppresses duplicate lines spoken within a short window.
  - Never fails the calling hook: any speech error exits 0.

  The message is received as a typed parameter, never interpolated into a
  shell command, so there is no shell-injection surface.

.EXAMPLE
  ./speak.ps1 -Message "Task finished."
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Message
)

# .claude/  (parent of this script's folder, .claude/scripts/)
$claudeDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)

# --- Mute switch -------------------------------------------------------------
$muteFile = Join-Path $claudeDir '.speak-muted'
if ($env:CLAUDE_SPEAK_MUTE -eq '1' -or (Test-Path -LiteralPath $muteFile)) { exit 0 }

# --- Sanitize: letters, digits, spaces, and a little safe punctuation only ---
$clean = ($Message -replace '[^\p{L}\p{N} \.\,\!\?\:\;\-]', ' ')
$clean = ($clean -replace '\s+', ' ').Trim()
if ($clean.Length -gt 200) { $clean = $clean.Substring(0, 200) }
if ([string]::IsNullOrWhiteSpace($clean)) { exit 0 }

# --- Dedup: skip an identical line spoken in the last 10 seconds --------------
$lastFile = Join-Path $claudeDir '.speak-last'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
try {
  if (Test-Path -LiteralPath $lastFile) {
    $prev = Get-Content -Raw -LiteralPath $lastFile | ConvertFrom-Json
    if ($prev.text -eq $clean -and ($now - [int64]$prev.ts) -lt 10) { exit 0 }
  }
} catch { }
try {
  (@{ text = $clean; ts = $now } | ConvertTo-Json -Compress) |
    Set-Content -LiteralPath $lastFile -Encoding UTF8
} catch { }

# --- Speak: System.Speech, then SAPI COM; never fail the hook ----------------
try {
  Add-Type -AssemblyName System.Speech -ErrorAction Stop
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Speak($clean)
  $synth.Dispose()
  exit 0
} catch {
  try {
    $voice = New-Object -ComObject SAPI.SpVoice
    $null = $voice.Speak($clean, 0)
    exit 0
  } catch {
    exit 0
  }
}
