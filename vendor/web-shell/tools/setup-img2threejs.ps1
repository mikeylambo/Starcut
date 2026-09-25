$ErrorActionPreference = 'Stop'

$repoUrl = 'https://github.com/img2threejs/img2threejs.git'
$sharedRoot = Join-Path $HOME '.slu-tools'
$checkout = Join-Path $sharedRoot 'img2threejs'
$codexSkill = Join-Path $HOME '.codex\skills\img2threejs'
$claudeSkill = Join-Path $HOME '.claude\skills\img2threejs'

New-Item -ItemType Directory -Force -Path $sharedRoot | Out-Null

if (Test-Path (Join-Path $checkout '.git')) {
  Write-Host "Updating img2threejs at $checkout"
  git -C $checkout pull --ff-only
} else {
  Write-Host "Cloning img2threejs to $checkout"
  git clone $repoUrl $checkout
}

function Ensure-SkillLink([string]$linkPath) {
  $parent = Split-Path -Parent $linkPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null

  if (Test-Path $linkPath) {
    $item = Get-Item $linkPath -Force
    if ($item.LinkType -or $item.Attributes.ToString().Contains('ReparsePoint')) {
      Remove-Item $linkPath -Force
    } else {
      Write-Host "Existing non-link path found at $linkPath; leaving it untouched."
      return
    }
  }

  try {
    New-Item -ItemType SymbolicLink -Path $linkPath -Target $checkout | Out-Null
    Write-Host "Linked $linkPath -> $checkout"
  } catch {
    Write-Host "Symlink failed; trying junction for $linkPath"
    New-Item -ItemType Junction -Path $linkPath -Target $checkout | Out-Null
  }
}

Ensure-SkillLink $codexSkill
Ensure-SkillLink $claudeSkill

Write-Host ''
Write-Host 'img2threejs is installed from one shared checkout.'
Write-Host "Shared checkout: $checkout"
Write-Host 'Restart/reload Codex or Claude after first installation so the skill is discovered.'
