# 合併後：啟用 GitHub Pages（workflow 模式）並等待部署完成
# 用法：pwsh -File scripts/github-post-merge.ps1
# 前置：token 在 $env:TEMP\gh-token.txt（需要 Pages: read and write，或 admin）
param(
  [string]$Owner = 'ssbbmmlui',
  [string]$Repo = 'testing456',
  [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$tokenPath = Join-Path $env:TEMP 'gh-token.txt'
if (-not (Test-Path $tokenPath)) { throw "找不到 token 檔：$tokenPath" }
$token = (Get-Content $tokenPath -Raw).Trim()
$headers = @{
  Authorization          = "Bearer $token"
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent'           = 'wordlab-post-merge'
}
$api = "https://api.github.com/repos/$Owner/$Repo"

function Call([string]$Method, [string]$Url, $Body) {
  $p = @{ Method = $Method; Uri = $Url; Headers = $headers; ErrorAction = 'Stop' }
  if ($null -ne $Body) { $p.Body = ($Body | ConvertTo-Json); $p.ContentType = 'application/json' }
  Invoke-RestMethod @p
}

Write-Host '[1/3] 檢查 main 分支…'
$main = Call GET "$api/branches/main"
Write-Host "  main HEAD: $($main.commit.sha.Substring(0,7)) — $($main.commit.commit.message.Split("`n")[0])"

Write-Host '[2/3] 啟用 GitHub Pages（Source: GitHub Actions）…'
try {
  $site = Call GET "$api/pages"
  Write-Host "  Pages 已存在：$($site.html_url) · build_type=$($site.build_type)"
  if ($site.build_type -ne 'workflow') {
    $site = Call PUT "$api/pages" @{ build_type = 'workflow' }
    Write-Host "  已切換為 workflow：$($site.html_url)"
  }
} catch {
  if ($_.ErrorDetails.Message -match '404') {
    $site = Call POST "$api/pages" @{ build_type = 'workflow' }
    Write-Host "  已啟用 Pages：$($site.html_url)"
  } else {
    throw
  }
}

Write-Host '[3/3] 等待「Deploy WordLab to GitHub Pages」執行…'
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$run = $null
while ((Get-Date) -lt $deadline) {
  $runs = Call GET "$api/actions/runs?per_page=5"
  $run = $runs.workflow_runs | Where-Object { $_.name -like '*Deploy WordLab*' } | Select-Object -First 1
  if ($run -and $run.status -eq 'completed') { break }
  Start-Sleep -Seconds 8
  Write-Host "  … $($run.status) / $($run.conclusion)"
}

if (-not $run) { Write-Host '  找不到 workflow run，請到 Actions 頁查看。'; exit 0 }
Write-Host "  run #$($run.run_number): $($run.status) / $($run.conclusion)"
Write-Host "  $($run.html_url)"
if ($run.conclusion -eq 'success') {
  $pages = Call GET "$api/pages"
  Write-Host "`n✔ 部署成功：$($pages.html_url)"
} else {
  Write-Host "`n✖ 部署失敗，請看 run log：$($run.html_url)"
  exit 1
}
