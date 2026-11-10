[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$Compiler = $env:ISCC_PATH,
    [string]$NodePath = '',
    [string]$OutputPath = '',
    [string]$NodeLicense = '',
    [switch]$CheckOnly,
    [switch]$SkipPause
)
$ErrorActionPreference = 'Stop'
# Native Node/launcher output and redirected build messages share UTF-8,
# including on non-Chinese Windows and when started without a console.
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$originalProcessPath = $env:PATH
$buildExit = 0
$nodeDownload = 'https://nodejs.org/en/download'
$innoDownload = 'https://jrsoftware.org/isdl.php'

function Find-Node {
    if ($NodePath) { return [IO.Path]::GetFullPath($NodePath) }
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    if ($env:ProgramFiles) {
        $standard = Join-Path $env:ProgramFiles 'nodejs/node.exe'
        if (Test-Path -LiteralPath $standard -PathType Leaf) { return $standard }
    }
    return $null
}
function Find-Inno {
    if ($Compiler) { return [IO.Path]::GetFullPath($Compiler) }
    $found = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    $candidates = @()
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if ($base) {
            $candidates += Join-Path $base 'Inno Setup 7/ISCC.exe'
            $candidates += Join-Path $base 'Programs/Inno Setup 7/ISCC.exe'
        }
    }
    $candidates += Join-Path $productRoot '.temp/installer-tools/inno/ISCC.exe'
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }
    return $null
}

try {
    Write-Host 'QuizForge 安装包构建' -ForegroundColor Cyan
    Write-Host '此工具不会安装 Node.js／Inno Setup、启动应用、注册协议或发布 Release。'
    if (-not [Environment]::Is64BitOperatingSystem) { throw '打包需要 64 位 Windows 10/11。' }
    if (-not (Test-Path -LiteralPath (Join-Path $productRoot 'core/package-lock.json'))) { throw '请在完整源码目录运行此入口。' }
    $missing = @()
    $node = Find-Node
    $npm = $null
    if (-not $node -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
        $missing += "缺少 Node.js 24 x64（含 npm）。请从 $nodeDownload 选择 v24.x、Windows x64 安装包。安装后重新打开本窗口；也可用 -NodePath 指定已解压的 node.exe。"
    } else {
        $nodeInfo = $null
        try {
            $probe = & $node --eval 'console.log(JSON.stringify({version:process.versions.node,arch:process.arch,platform:process.platform}))'
            if ($LASTEXITCODE -eq 0) { $nodeInfo = $probe | ConvertFrom-Json }
        } catch { }
        if (-not $nodeInfo -or $nodeInfo.version -notmatch '^24\.' -or $nodeInfo.arch -ne 'x64' -or $nodeInfo.platform -ne 'win32') {
            $missing += "需要 Windows x64 的 Node.js 24。请检查 PATH 或用 -NodePath 指定正确版本：$nodeDownload"
        } else {
            Write-Host ("Node.js: v{0}，{1}" -f $nodeInfo.version, $node)
        }
        $npm = Join-Path (Split-Path -Parent $node) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { $missing += "缺少与 Node.js 配套的 npm.cmd，请重新安装含 npm 的官方 Node.js 24：$nodeDownload" }
    }
    $iscc = Find-Inno
    if (-not $iscc -or -not (Test-Path -LiteralPath $iscc -PathType Leaf)) {
        $missing += "缺少 Inno Setup 7.1 或更高版本。官方下载：$innoDownload 。安装后重试，或用 -Compiler／ISCC_PATH 指定 ISCC.exe。"
    } else {
        $compilerVersion = (& $iscc --version) -join ' '
        $compilerStatus = $LASTEXITCODE
        $compilerMatch = [regex]::Match($compilerVersion, '\b\d+\.\d+(?:\.\d+)?\b')
        if ($compilerStatus -ne 0 -or -not $compilerMatch.Success -or [version]$compilerMatch.Value -lt [version]'7.1') {
            $missing += "Inno Setup 版本不符，需要 7.1 或更高版本：$innoDownload"
        } else { Write-Host ("Inno Setup: {0}，{1}" -f $compilerVersion, $iscc) }
    }
    $framework = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
    if (-not $framework -or $framework.Release -lt 528040 -or -not (Test-Path -LiteralPath (Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'))) {
        $missing += '缺少 .NET Framework 4.8，请通过 Windows 更新安装；不需要另装 .NET SDK。'
    }
    if ($missing.Count) { throw ($missing -join [Environment]::NewLine) }
    if ($NodeLicense -and -not (Test-Path -LiteralPath $NodeLicense -PathType Leaf)) { throw '-NodeLicense 指定的许可证文件不存在。' }
    if ($CheckOnly) {
        Write-Host '环境检查通过。未安装依赖、未编译、未生成安装包。' -ForegroundColor Green
    } else {
        if (-not $Version) {
            $baseVersion = ((Get-Content -LiteralPath (Join-Path $productRoot 'core/package.json') -Raw | ConvertFrom-Json).version -split '-')[0]
            $suggested = $baseVersion + '-local.' + (Get-Date -Format 'yyyyMMdd.HHmmss')
            $Version = Read-Host "安装包版本号（留空使用本地测试标签 $suggested）"
            if (-not $Version) { $Version = $suggested }
        }
        if ($Version -notmatch '^[A-Za-z0-9_.-]{1,80}$') { throw '版本号只能包含英文、数字、点、横线和下划线，最多 80 个字符。' }
        $output = if ($OutputPath) { [IO.Path]::GetFullPath($OutputPath) } else { Join-Path $productRoot 'dist' }
        $packageFile = Join-Path $output ("QuizForge-{0}-win-x64-setup.exe" -f $Version)
        if (Test-Path -LiteralPath $packageFile) { throw '同版本安装包已存在，请更换版本号或输出目录，不会覆盖原包。' }

        # Pin npm and its child processes to the selected Node without changing
        # the user's persistent PATH. Avoid rewriting dependencies on every run.
        $env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $originalProcessPath
        $dependencyScript = Join-Path $productRoot 'core/server/host/platform/dependencies.js'
        $dependencyProbe = 'const {pathToFileURL}=await import(''node:url''); const {dependencyDifferences}=await import(pathToFileURL(process.argv[1])); const names=dependencyDifferences(process.argv[2],{includeDev:true}); if(names.length) console.log(names.join()); process.exitCode=names.length?3:0;'
        Write-Host '[1/3] 检查项目依赖…'
        $difference = & $node --input-type=module --eval $dependencyProbe $dependencyScript $productRoot
        $dependencyExit = $LASTEXITCODE
        if ($dependencyExit -eq 3) {
            $lockFile = Join-Path $productRoot '.state/host.lock'
            if (Test-Path -LiteralPath $lockFile) {
                try { $owner = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json } catch { throw '无法确认源码服务是否运行，请先保存并关闭源码服务，再更新依赖。' }
                if (-not $owner.pid -or (Get-Process -Id $owner.pid -ErrorAction SilentlyContinue)) { throw '源码目录服务仍在运行，请先保存并退出，再更新项目依赖。' }
            }
            Write-Host ('需要安装或更新依赖：' + ($difference -join ' '))
            & $npm --prefix (Join-Path $productRoot 'core') ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。请检查网络和 npm 输出，修复后重新打包。' }
        } elseif ($dependencyExit -ne 0) { throw '无法检查项目依赖，请检查 core/package-lock.json 和 Node.js 输出。' }
        else { Write-Host '项目依赖已匹配，跳过 npm ci。' }

        $work = Join-Path $productRoot ('.temp/installer-entry-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $work -Force | Out-Null
        $launcher = Join-Path $work 'QuizForge.exe'
        Write-Host '[2/3] 编译隔离的托盘启动器…'
        & (Join-Path $PSScriptRoot 'build-windows-launcher.ps1') -OutputPath $launcher
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw '托盘启动器编译失败，已停止打包。' }
        Write-Host '[3/3] 打包安装程序…'
        $arguments = @((Join-Path $PSScriptRoot 'build-windows-installer.mjs'), '--version', $Version, '--node', $node, '--compiler', $iscc, '--launcher', $launcher, '--output', $output)
        if ($NodeLicense) { $arguments += @('--node-license', [IO.Path]::GetFullPath($NodeLicense)) }
        # Keep the JSON build receipt for diagnostics without flooding the UI.
        $receipt = & $node @arguments
        if ($LASTEXITCODE -ne 0) { throw '安装包生成失败，请检查上方错误输出。' }
        $receipt | Set-Content -LiteralPath (Join-Path $work 'result.json') -Encoding UTF8
        if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf) -or -not (Test-Path -LiteralPath ($packageFile + '.sha256') -PathType Leaf)) { throw '构建未生成预期的安装包或校验文件，请检查构建日志。' }
        Write-Host ("构建完成：{0}" -f $packageFile) -ForegroundColor Green
        Write-Host ("SHA-256：{0}" -f ($packageFile + '.sha256'))
        Write-Host '这是本地构建，未安装应用、未发布或上传 GitHub。'
    }
} catch {
    $buildExit = 1
    Write-Host ("构建未完成：{0}" -f $_.Exception.Message) -ForegroundColor Red
} finally {
    $env:PATH = $originalProcessPath
}
if (-not $SkipPause -and -not $CheckOnly) { [void](Read-Host '按 Enter 关闭窗口') }
exit $buildExit
