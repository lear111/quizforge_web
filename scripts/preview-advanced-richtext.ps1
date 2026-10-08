param([int]$Port = 8796)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previewRoot = Join-Path $projectRoot ('target/verification/advanced-richtext-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $previewRoot | Out-Null
foreach ($folder in @('web','server','shared')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination $previewRoot -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $previewRoot 'extensions'), (Join-Path $previewRoot 'question-banks') | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'extensions/short-answer-1.2.1') -Destination (Join-Path $previewRoot 'extensions') -Recurse
$dependencyRoot = Join-Path $previewRoot 'node_modules'
New-Item -ItemType Directory -Path $dependencyRoot | Out-Null
foreach ($dependency in @('ajv','fast-deep-equal','fast-uri','json-schema-traverse','require-from-string')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "node_modules/$dependency") -Destination $dependencyRoot -Recurse
}
$demoRoot = Join-Path $previewRoot 'question-banks/advanced-richtext-demo'
New-Item -ItemType Directory -Path $demoRoot | Out-Null
$example = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'extensions/short-answer-1.2.1/examples.json') | ConvertFrom-Json
$example.id = 'advanced-richtext-demo'
$example.title = '高级富文本演示'
$example | ConvertTo-Json -Depth 100 | Set-Content -Encoding utf8 -LiteralPath (Join-Path $demoRoot 'bank.json')
Copy-Item -LiteralPath (Join-Path $projectRoot 'extensions/short-answer-1.2.1/assets') -Destination $demoRoot -Recurse
$jarPath = Join-Path $projectRoot 'target/quizforge-web-1.0.0.jar'
$nodePath = (Get-Command node).Source
$previewProcess = Start-Process -FilePath (Get-Command java).Source -WindowStyle Hidden -PassThru -ArgumentList @('-jar', ('"' + $jarPath + '"'), '--root', ('"' + $previewRoot + '"'), '--host', '127.0.0.1', '--port', "$Port", '--node', ('"' + $nodePath + '"'), '--upgrade-short-answer') -RedirectStandardOutput (Join-Path $previewRoot 'server.out.log') -RedirectStandardError (Join-Path $previewRoot 'server.err.log')
[pscustomobject]@{ Root=$previewRoot; Pid=$previewProcess.Id; Url="http://127.0.0.1:$Port/" } | ConvertTo-Json
