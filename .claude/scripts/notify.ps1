<#
.SYNOPSIS
  Claude Code hook dispatcher: turns a hook event into a fixed spoken line.

.DESCRIPTION
  Wired to Stop / Notification / SubagentStop hooks. It maps the event to a
  canned, secret-free sentence and hands it to speak.ps1.

  The hook payload arriving on stdin is deliberately DISCARDED — this is the
  safety guarantee that no source code, terminal output, credentials, or stack
  traces can ever be spoken. Only the whitelisted lines below are ever voiced.

.EXAMPLE
  ./notify.ps1 -Event stop
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('stop', 'notify', 'subagent', 'test')]
  [string]$Event
)

$lines = @{
  stop     = 'Task finished.'
  notify   = 'Claude needs your input.'
  subagent = 'A sub-agent finished its work.'
  test     = 'Speech test. Momentum is online.'
}

# Drain (and ignore) the hook JSON so the process doesn't block on the pipe.
# Only read when stdin is actually redirected, so manual runs don't hang.
if ([Console]::IsInputRedirected) {
  try { $null = [Console]::In.ReadToEnd() } catch { }
}

& (Join-Path $PSScriptRoot 'speak.ps1') -Message $lines[$Event]
exit 0
