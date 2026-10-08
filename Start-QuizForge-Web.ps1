param(
  [int]$Port = 8787,
  [switch]$Lan,
  [string]$AccessToken = '',
  [switch]$NoBrowser,
  [switch]$SkipBuild,
  [switch]$Rebuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$coreRoot = Join-Path $projectRoot 'core'
$previousLocation = Get-Location
$launcherMutex = $null
$ownsMutex = $false
$browserHelper = $null

function Find-RunningQuizForge {
  $processes = Get-CimInstance Win32_Process -Filter "Name='java.exe' OR Name='javaw.exe'" -ErrorAction SilentlyContinue
  foreach ($candidate in $processes) {
    $commandLine = $candidate.CommandLine
    if (-not $commandLine -or $commandLine -notmatch 'quizforge-web-[\w.\-]+\.jar|io\.quizforge\.web\.Main') { continue }
    $rootMatch = [regex]::Match($commandLine, '(?:^|\s)--root\s+(?:"(?<root>[^"]+)"|(?<root>\S+))')
    $portMatch = [regex]::Match($commandLine, '(?:^|\s)--port\s+"?(?<port>\d+)"?(?:\s|$)')
    if (-not $rootMatch.Success -or -not $portMatch.Success) { continue }
    $candidateRoot = $rootMatch.Groups['root'].Value
    if (-not [IO.Path]::IsPathRooted($candidateRoot)) { continue }
    if ([IO.Path]::GetFullPath($candidateRoot).TrimEnd('\') -ieq $projectRoot) {
      return [pscustomobject]@{ Port = [int]$portMatch.Groups['port'].Value; Pid = $candidate.ProcessId }
    }
  }
}

function Open-ExistingQuizForge($running) {
  $existingUrl = "http://127.0.0.1:$($running.Port)/"
  Write-Host "QuizForge 已在运行，复用当前服务：$existingUrl" -ForegroundColor Green
  if ($running.Port -ne $Port) { Write-Host '如需更换端口，请先关闭原来的启动窗口。' }
  if (-not $NoBrowser) {
    & (Join-Path $coreRoot 'scripts/Open-QuizForge-WhenReady.ps1') -Port $running.Port -LauncherPid $PID -AllowLogin
  }
}

function Test-PortInUse {
  $probe = New-Object Net.Sockets.TcpClient
  try {
    $pending = $probe.ConnectAsync('127.0.0.1', $Port)
    try { return ($pending.Wait(1000) -and $probe.Connected) } catch { return $false }
  } finally { $probe.Dispose() }
}

function Test-DependenciesReady {
  $sourceLock = Join-Path $coreRoot 'package-lock.json'
  $installedLock = Join-Path $coreRoot 'node_modules/.package-lock.json'
  if (-not (Test-Path -LiteralPath $installedLock)) { return $false }
  foreach ($name in @('ajv', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string')) {
    if (-not (Test-Path -LiteralPath (Join-Path $coreRoot "node_modules/$name/package.json"))) { return $false }
  }
  # npm locks contain an empty property name, unsupported by Windows PowerShell's JSON reader.
  $checkLock = @'
try {
  const fs = require('node:fs');
  const wanted = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).packages;
  const installed = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).packages;
  if (!wanted || !installed) process.exit(1);
  for (const [name, pkg] of Object.entries(wanted)) {
    if (!name) continue;
    if (pkg.os && !pkg.os.includes(process.platform)) continue;
    if (pkg.cpu && !pkg.cpu.includes(process.arch)) continue;
    const present = installed[name];
    if (!present && pkg.optional) continue;
    if (!present || present.version !== pkg.version || present.integrity !== pkg.integrity) process.exit(1);
  }
} catch { process.exit(1); }
'@
  & $nodeCommand.Source -e $checkLock $sourceLock $installedLock
  return $LASTEXITCODE -eq 0
}

try {
  if ($Port -lt 1 -or $Port -gt 65535) { throw '端口必须在 1 到 65535 之间。' }
  if ($SkipBuild -and $Rebuild) { throw '-SkipBuild 和 -Rebuild 不能同时使用。' }
  Set-Location -LiteralPath $coreRoot

  # Keep the lock for the lifetime of this foreground launcher, before Java can recover state.
  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $rootHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '') }
  finally { $hasher.Dispose() }
  $launcherMutex = New-Object Threading.Mutex($false, "Local\QuizForgeWeb-$rootHash")
  try { $ownsMutex = $launcherMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  $running = Find-RunningQuizForge
  if ($running) { Open-ExistingQuizForge $running; exit 0 }
  if (-not $ownsMutex) {
    Write-Host 'QuizForge 已在另一个窗口启动中，请等待原窗口完成。' -ForegroundColor Yellow
    exit 0
  }
  if (Test-PortInUse) { throw "端口 $Port 已被其他程序占用。请关闭占用程序，或使用 -Port 8789 指定其他端口。" }

  $javaCommand = Get-Command java -ErrorAction SilentlyContinue
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $javaCommand) { throw '未找到 Java。请安装 JDK 21 或更高版本，并重新打开启动脚本。' }
  if (-not $nodeCommand) { throw '未找到 Node.js。请安装 Node.js 24，并重新打开启动脚本。' }
  $javaVersion = (& $javaCommand.Source --version | Out-String)
  if ($LASTEXITCODE -ne 0 -or $javaVersion -notmatch '(?m)^(?:openjdk|java)\s+(\d+)' -or [int]$Matches[1] -lt 21) { throw 'Java 版本不符合要求，需要 JDK 21 或更高版本。' }
  $nodeVersion = (& $nodeCommand.Source --version | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw "Node.js 版本不符合要求，需要 Node.js 24，当前为 $nodeVersion。" }

  if (-not (Test-DependenciesReady)) {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { throw '依赖需要安装，但未找到 npm。请重新安装 Node.js 24。' }
    Write-Host '正在安装或更新 Node 依赖，首次运行可能需要联网……'
    & $npmCommand.Source ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Node 依赖安装失败，请检查网络和上方错误后重新双击启动。' }
  }

  $jarPath = Join-Path $coreRoot 'target/quizforge-web-1.0.0.jar'
  $needsBuild = $Rebuild -or -not (Test-Path -LiteralPath $jarPath)
  if (-not $needsBuild -and -not $SkipBuild) {
    $jarTime = (Get-Item -LiteralPath $jarPath).LastWriteTimeUtc
    $buildInputs = @((Get-Item -LiteralPath (Join-Path $coreRoot 'pom.xml')))
    $buildInputs += @(Get-ChildItem -LiteralPath (Join-Path $coreRoot 'src/main') -Recurse -File)
    $needsBuild = @($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $jarTime }).Count -gt 0
  }
  if ($needsBuild) {
    $mavenCommand = Get-Command mvn.cmd -ErrorAction SilentlyContinue
    if (-not $mavenCommand) { throw '需要构建 Java 程序，但未找到 Maven。请安装 Maven 并加入 PATH 后重新启动。' }
    Write-Host '正在构建 QuizForge Web……'
    & $mavenCommand.Source -q '-DskipTests' package
    if ($LASTEXITCODE -ne 0) { throw 'Java 构建失败，请查看上方错误后重新启动。' }
  } else { Write-Host '使用已有构建，跳过 Maven。' }

  $bindAddress = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
  if ($Lan -and -not $AccessToken) {
    $tokenBytes = New-Object byte[] 24
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($tokenBytes) } finally { $generator.Dispose() }
    $AccessToken = [BitConverter]::ToString($tokenBytes).Replace('-', '').ToLowerInvariant()
  }
  $baseUrl = "http://127.0.0.1:$Port/"
  $serverArguments = @('-jar', $jarPath, '--root', $projectRoot, '--host', $bindAddress, '--port', "$Port", '--node', $nodeCommand.Source, '--upgrade-short-answer')
  if ($AccessToken) { $serverArguments += @('--token', $AccessToken) }
  if (-not $NoBrowser) {
    $helperPath = (Join-Path $coreRoot 'scripts/Open-QuizForge-WhenReady.ps1').Replace("'", "''")
    $helperToken = $AccessToken.Replace("'", "''")
    $helperCommand = "& '$helperPath' -Port $Port -LauncherPid $PID -AccessToken '$helperToken'"
    $encodedHelper = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($helperCommand))
    $browserHelper = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedHelper)
  }
  Write-Host "QuizForge Web: $baseUrl" -ForegroundColor Green
  if (-not $NoBrowser) { Write-Host '服务就绪后会自动打开浏览器；也可手动访问上方地址。' }
  if (-not $Lan) { Write-Host '局域网连接和密码可在网页左下角的设置中配置。' }
  if ($Lan) {
    Write-Host '局域网已启用。平板可访问这台电脑的局域网 IP 与相同端口。'
    Write-Host '临时访问口令（仅在当前窗口显示）：'
    Write-Host $AccessToken
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | ForEach-Object { Write-Host ("  http://" + $_.IPAddress + ":$Port/") }
  }
  Write-Host '请保持本窗口打开。关闭窗口或按 Ctrl+C 停止服务。'
  & $javaCommand.Source @serverArguments
  if ($LASTEXITCODE -ne 0) { throw '服务未能启动或异常退出，请查看上方错误信息。' }
} catch {
  Write-Host ("启动失败：" + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($browserHelper -and -not $browserHelper.HasExited) { Stop-Process -Id $browserHelper.Id -ErrorAction SilentlyContinue }
  if ($ownsMutex) { $launcherMutex.ReleaseMutex() }
  if ($launcherMutex) { $launcherMutex.Dispose() }
  Set-Location -LiteralPath $previousLocation
}
