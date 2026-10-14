param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
# The caller verifies the publisher archive before extraction into its fresh owned directory.
if (-not [System.IO.Path]::IsPathRooted($Archive) -or -not [System.IO.Path]::IsPathRooted($Destination)) { throw 'Native extraction requires absolute owned paths' }
if (-not (Get-Command Expand-Archive -ErrorAction SilentlyContinue)) { throw 'PowerShell ZIP extraction is unavailable' }
Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
