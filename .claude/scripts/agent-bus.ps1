<#
.SYNOPSIS
  Lightweight file-based message bus for coordinating multiple Claude Code
  sessions / agents on this machine.

.DESCRIPTION
  A portable fallback for environments with no native cross-session messaging.
  State lives under .claude/agent-bus/ :
    agents/<id>.json          identity, state, heartbeat
    inbox/<id>/<ts>-<from>.json   per-agent messages
    tasks/<id>.json           task ownership + completion summary

  Writes are atomic (temp file + rename). Task claims use exclusive create,
  so two sessions cannot own the same task. No background service: inboxes are
  polled on demand via the 'inbox' verb.

  Nothing sensitive should be placed in messages; treat bodies as shareable.

.EXAMPLE
  $env:CLAUDE_AGENT_ID = 'builder'
  ./agent-bus.ps1 register
  ./agent-bus.ps1 send -To reviewer -Subject "PR ready" -Body "branch feat-x is green"
  ./agent-bus.ps1 inbox
  ./agent-bus.ps1 claim-task -Task deploy-123
  ./agent-bus.ps1 complete -Task deploy-123 -Summary "deployed to staging"
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('register', 'status', 'list-agents', 'send', 'inbox', 'claim-task', 'complete')]
  [string]$Command,

  [string]$Agent = $env:CLAUDE_AGENT_ID,
  [string]$To,
  [string]$Subject = '',
  [string]$Body = '',
  [string]$Task,
  [string]$Summary = '',
  [ValidateSet('active', 'idle', 'done')]
  [string]$State = 'active'
)

$ErrorActionPreference = 'Stop'

$root = Join-Path (Split-Path -Parent $PSScriptRoot) 'agent-bus'
foreach ($d in @('agents', 'inbox', 'tasks')) {
  $p = Join-Path $root $d
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function Now { [DateTimeOffset]::UtcNow.ToString('o') }
function Stamp { [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfff') }
function Safe([string]$s) { return ($s -replace '[^A-Za-z0-9_.-]', '_') }

function Write-Atomic([string]$Path, $Object) {
  $json = $Object | ConvertTo-Json -Depth 8
  $tmp = "$Path.$PID.tmp"
  Set-Content -LiteralPath $tmp -Value $json -Encoding UTF8
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Require-Agent {
  if ([string]::IsNullOrWhiteSpace($Agent)) {
    throw "No agent id. Pass -Agent <id> or set `$env:CLAUDE_AGENT_ID."
  }
}

switch ($Command) {

  'register' {
    Require-Agent
    $id = Safe $Agent
    $inbox = Join-Path $root "inbox/$id"
    if (-not (Test-Path -LiteralPath $inbox)) { New-Item -ItemType Directory -Force -Path $inbox | Out-Null }
    Write-Atomic (Join-Path $root "agents/$id.json") @{
      id = $id; state = $State; pid = $PID; registeredAt = (Now); heartbeat = (Now)
    }
    Write-Output "registered agent '$id'"
  }

  'status' {
    Require-Agent
    $id = Safe $Agent
    $file = Join-Path $root "agents/$id.json"
    $rec = if (Test-Path -LiteralPath $file) { Get-Content -Raw -LiteralPath $file | ConvertFrom-Json } else { @{ id = $id; registeredAt = (Now) } }
    Write-Atomic $file @{
      id = $id; state = $State; pid = $PID
      registeredAt = $rec.registeredAt; heartbeat = (Now)
    }
    Write-Output "agent '$id' -> $State"
  }

  'list-agents' {
    $files = Get-ChildItem -LiteralPath (Join-Path $root 'agents') -Filter *.json -ErrorAction SilentlyContinue
    if (-not $files) { Write-Output "(no agents registered)"; break }
    $files | ForEach-Object {
      $a = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
      [pscustomobject]@{ Agent = $a.id; State = $a.state; Heartbeat = $a.heartbeat }
    } | Format-Table -AutoSize | Out-String | Write-Output
  }

  'send' {
    Require-Agent
    if ([string]::IsNullOrWhiteSpace($To)) { throw "send requires -To <agent-id>." }
    $from = Safe $Agent
    $to = Safe $To
    $dest = Join-Path $root "inbox/$to"
    if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
    $file = Join-Path $dest ("{0}-{1}.json" -f (Stamp), $from)
    Write-Atomic $file @{
      from = $from; to = $to; subject = $Subject; body = $Body; ts = (Now)
    }
    Write-Output "sent to '$to'"
  }

  'inbox' {
    Require-Agent
    $id = Safe $Agent
    $dir = Join-Path $root "inbox/$id"
    $msgs = Get-ChildItem -LiteralPath $dir -Filter *.json -ErrorAction SilentlyContinue | Sort-Object Name
    if (-not $msgs) { Write-Output "(inbox empty for '$id')"; break }
    $msgs | ForEach-Object {
      $m = Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json
      [pscustomobject]@{ Time = $m.ts; From = $m.from; Subject = $m.subject; Body = $m.body }
    } | Format-Table -AutoSize | Out-String | Write-Output
  }

  'claim-task' {
    Require-Agent
    if ([string]::IsNullOrWhiteSpace($Task)) { throw "claim-task requires -Task <id>." }
    $id = Safe $Agent
    $file = Join-Path $root ("tasks/{0}.json" -f (Safe $Task))
    try {
      # Exclusive create: throws if the file already exists -> already claimed.
      $fs = [System.IO.File]::Open($file, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes((@{
          task = (Safe $Task); owner = $id; state = 'claimed'; claimedAt = (Now); summary = $null
        } | ConvertTo-Json -Depth 8))
        $fs.Write($bytes, 0, $bytes.Length)
      } finally { $fs.Close() }
      Write-Output "claimed task '$(Safe $Task)' for '$id'"
    } catch [System.IO.IOException] {
      $owner = (Get-Content -Raw -LiteralPath $file | ConvertFrom-Json).owner
      Write-Output "task '$(Safe $Task)' already owned by '$owner'"
      exit 1
    }
  }

  'complete' {
    Require-Agent
    if ([string]::IsNullOrWhiteSpace($Task)) { throw "complete requires -Task <id>." }
    $id = Safe $Agent
    $file = Join-Path $root ("tasks/{0}.json" -f (Safe $Task))
    if (-not (Test-Path -LiteralPath $file)) { throw "task '$(Safe $Task)' is not claimed." }
    $rec = Get-Content -Raw -LiteralPath $file | ConvertFrom-Json
    if ($rec.owner -ne $id) { Write-Output "refused: task owned by '$($rec.owner)', not '$id'"; exit 1 }
    Write-Atomic $file @{
      task = $rec.task; owner = $id; state = 'done'
      claimedAt = $rec.claimedAt; completedAt = (Now); summary = $Summary
    }
    Write-Output "completed task '$(Safe $Task)'"
  }
}
