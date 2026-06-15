$out = @()
$roots = Get-ChildItem -Path 'D:\' -Directory -Force -ErrorAction SilentlyContinue
foreach ($dir in $roots) {
  $full = $dir.FullName
  if ($dir.Name -match 'rag|agent|remote') {
    $out += [pscustomobject]@{ Path = $full; Type = 'dir'; Reason = 'name-match' }
  }

  $state = Join-Path $full 'state'
  if (Test-Path $state) {
    $out += [pscustomobject]@{ Path = $state; Type = 'dir'; Reason = 'state' }
  }

  $versions101 = Join-Path $full 'versions\client\1.0.1'
  if (Test-Path $versions101) {
    $out += [pscustomobject]@{ Path = $versions101; Type = 'dir'; Reason = 'client-1.0.1' }
  }

  $versionsRoot = Join-Path $full 'versions\client'
  if (Test-Path $versionsRoot) {
    $out += [pscustomobject]@{ Path = $versionsRoot; Type = 'dir'; Reason = 'client-versions-root' }
  }
}
$out | Sort-Object Path -Unique | ConvertTo-Json -Depth 4
