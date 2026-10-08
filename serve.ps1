# Baja75 Scoring Management System: a small web server for this computer only (http://localhost:7575/).
# Windows 11 has everything this needs (Windows PowerShell). Nothing is installed; close this window to stop it.
# Your data is kept by the browser for this address, so always open the app at the same address.
param([int]$Port = 7575, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path $here 'app'
if (-not (Test-Path (Join-Path $root 'index.html'))) { $root = Join-Path (Split-Path -Parent $here) 'dist' }
if (-not (Test-Path (Join-Path $root 'index.html'))) { Write-Host "Can't find the app files (app\index.html) next to this script." -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }
$root = (Resolve-Path $root).Path
$url = "http://localhost:$Port/"

$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'; '.txt' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
try { $listener.Start() }
catch {
  # already running (a second double-click): just open the app
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri ($url + 'index.html') -TimeoutSec 3; if ($r.Content -match 'Baja75 Scoring') { if (-not $NoBrowser) { Start-Process $url }; exit 0 } } catch { }
  Write-Host "Port $Port is used by another program. Close it, or run: serve.ps1 -Port 7576 (the app's data is kept per address, so keep using the same one)." -ForegroundColor Red
  Read-Host 'Press Enter to close'; exit 1
}

Write-Host ''
Write-Host '  Baja75 Scoring Management System' -ForegroundColor DarkYellow
Write-Host "  Running at $url  (this computer only)"
Write-Host '  Keep this window open while you use the app. Once installed from Edge it also opens without this window.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request; $res = $ctx.Response
    try {
      $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
      $rel = $path.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $file = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $file.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { $res.StatusCode = 403; $res.Close(); continue }
      if (-not (Test-Path $file -PathType Leaf)) {
        if ([System.IO.Path]::GetExtension($path) -eq '') { $file = Join-Path $root 'index.html' } else { $res.StatusCode = 404; $res.Close(); continue }
      }
      if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') { $res.StatusCode = 405; $res.Close(); continue }
      $ext = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $type = $types[$ext]; if (-not $type) { $type = 'application/octet-stream' }
      $res.ContentType = $type
      $res.Headers['X-Content-Type-Options'] = 'nosniff'
      $name = [System.IO.Path]::GetFileName($file)
      if ($name -eq 'index.html' -or $name -eq 'sw.js' -or $name -like 'workbox-*.js' -or $ext -eq '.webmanifest') { $res.Headers['Cache-Control'] = 'no-cache' }
      else { $res.Headers['Cache-Control'] = 'public, max-age=31536000, immutable' }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $res.ContentLength64 = $bytes.Length
      if ($req.HttpMethod -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      $res.Close()
    } catch {
      try { $res.StatusCode = 500; $res.Close() } catch { }
    }
  }
} finally { $listener.Stop() }
