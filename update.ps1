# LODESTAR 자동 업데이트: GitHub main의 최신 코드를 받아 이 폴더에 덮어쓰고 다시 빌드합니다.
# .env(키)와 pgdata(DB)는 건드리지 않아요. update.bat을 더블클릭하면 이 파일이 실행돼요.
$ErrorActionPreference = 'Stop'
$Repo = 'a01030930368-pixel/STOCK-assistant'
$Here = $PSScriptRoot

function Finish($msg) {
  Write-Host ''
  Write-Host $msg
  Read-Host '엔터를 누르면 창이 닫혀요' | Out-Null
  exit
}

try {
  if (-not (Test-Path (Join-Path $Here 'docker-compose.yml'))) {
    Finish 'update.bat을 LODESTAR 폴더(docker-compose.yml이 있는 곳) 안에서 실행해 주세요.'
  }
  if (-not (Test-Path (Join-Path $Here '.env'))) {
    Finish '이 폴더에 .env가 없어요. 키를 넣어 둔 LODESTAR 폴더에서 실행해 주세요.'
  }
  cmd /c 'docker info >nul 2>&1'
  if ($LASTEXITCODE -ne 0) {
    Finish 'Docker Desktop이 꺼져 있어요. Docker Desktop을 켜고, 아래쪽에 Engine running이 보이면 다시 실행해 주세요.'
  }

  $tmp = Join-Path $env:TEMP ('lodestar-update-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Write-Host '1/3 GitHub에서 최신 코드를 받는 중...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $zip = Join-Path $tmp 'main.zip'
  Invoke-WebRequest -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $tmp
  $src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1

  Write-Host '2/3 이 폴더에 덮어쓰는 중... (.env, pgdata는 그대로 둬요)'
  robocopy $src.FullName $Here /E /XF .env /XD pgdata backups node_modules .next /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Finish '파일을 덮어쓰지 못했어요. 열려 있는 파일이 있으면 닫고 다시 실행해 주세요.' }
  # 코드 폴더는 GitHub과 똑같이 맞춥니다. GitHub에서 지운 파일이 PC에 남아 화면이 엉키지 않게요.
  foreach ($d in @('web\src', 'worker\app', 'worker\tests', 'db')) {
    $from = Join-Path $src.FullName $d
    if (Test-Path $from) {
      robocopy $from (Join-Path $Here $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) { Finish '파일을 덮어쓰지 못했어요. 열려 있는 파일이 있으면 닫고 다시 실행해 주세요.' }
    }
  }
  Remove-Item -Path $tmp -Recurse -Force

  Write-Host '3/3 다시 빌드하고 켜는 중... (몇 분 걸릴 수 있어요)'
  Set-Location $Here
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { Finish '빌드 중에 오류가 났어요. 위 글씨를 캡처해서 보내 주세요. 키가 보이면 가려 주세요.' }
  Finish '업데이트 끝! 브라우저(폰은 앱)에서 새로고침해 보세요.'
} catch {
  Finish ('오류가 났어요: ' + $_.Exception.Message)
}
