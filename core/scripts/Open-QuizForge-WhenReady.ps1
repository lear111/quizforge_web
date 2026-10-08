param([int]$Port, [int]$LauncherPid, [string]$AccessToken = '', [switch]$AllowLogin)
$ErrorActionPreference = 'Stop'
$baseUrl = "http://127.0.0.1:$Port/"
$headers = @{}
if ($AccessToken) { $headers['X-QuizForge-Token'] = $AccessToken }
$deadline = [DateTime]::UtcNow.AddSeconds(90)
while ([DateTime]::UtcNow -lt $deadline) {
  if (-not (Get-Process -Id $LauncherPid -ErrorAction SilentlyContinue)) { return }
  $ready = $false
  try {
    $response = Invoke-RestMethod -Uri ($baseUrl + 'api/health') -Headers $headers -TimeoutSec 1 -Proxy $null
    $ready = $response.ok -eq $true
  } catch {
    # Reusing a known same-directory process can open its password screen without creating a new token.
    $ready = $AllowLogin -and $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401
  }
  if ($ready) {
    $browserUrl = if ($AccessToken) { $baseUrl + '#token=' + [Uri]::EscapeDataString($AccessToken) } else { $baseUrl }
    Start-Process $browserUrl
    return
  }
  Start-Sleep -Milliseconds 300
}
Write-Warning '服务尚未就绪，未打开浏览器。请检查启动窗口中的错误，或稍后手动打开网页。'
