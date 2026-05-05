#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$InstallDir = Join-Path $env:USERPROFILE ".agentfloor"
$Version    = if ($env:AGENTFLOOR_VERSION) { $env:AGENTFLOOR_VERSION } else { "latest" }
$RepoRef    = if ($env:AGENTFLOOR_VERSION) { $env:AGENTFLOOR_VERSION } else { "main" }
$RepoRaw    = "https://raw.githubusercontent.com/saketnayak/trading-command-center/$RepoRef"

function Write-Info    { param($m) Write-Host "[agentfloor] $m" -ForegroundColor Cyan }
function Write-Success { param($m) Write-Host "[agentfloor] $m" -ForegroundColor Green }
function Write-Fatal   { param($m) Write-Host "[agentfloor] ERROR: $m" -ForegroundColor Red; exit 1 }

# ── 1/7  check docker ──────────────────────────────────────────────────────
Write-Info "[1/7] Checking Docker..."
try { $null = docker version 2>&1 } catch { Write-Fatal "Docker not found. Install Docker Desktop from https://docker.com then re-run." }
try { $null = docker compose version 2>&1 } catch { Write-Fatal "Docker Compose plugin not found. Install Docker Desktop." }
$dockerVer = (docker version --format '{{.Server.Version}}' 2>$null) -replace '\..*'
if ([int]$dockerVer -lt 24) { Write-Fatal "Docker >= 24 required (found $dockerVer). Please upgrade Docker Desktop." }
Write-Success "Docker OK"

# ── 2/7  install directory ─────────────────────────────────────────────────
Write-Info "[2/7] Creating install directory at $InstallDir..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# ── 3/7  download files ────────────────────────────────────────────────────
Write-Info "[3/7] Downloading configuration files..."
Invoke-WebRequest "$RepoRaw/docker-compose.prod.yml" -OutFile "$InstallDir\docker-compose.yml" -UseBasicParsing
Invoke-WebRequest "$RepoRaw/nginx.conf"              -OutFile "$InstallDir\nginx.conf"         -UseBasicParsing

if ($Version -ne "latest") {
    $content = Get-Content "$InstallDir\docker-compose.yml" -Raw
    $content -replace ":latest", ":$Version" | Set-Content "$InstallDir\docker-compose.yml"
    Write-Info "Pinned to version $Version"
}

# ── helper: generate 32 random bytes as lowercase hex ─────────────────────
function New-HexSecret {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
    return ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLower()
}

# ── 4/7  generate or reuse secrets ────────────────────────────────────────
Write-Info "[4/7] Generating secrets..."
$EnvFile = "$InstallDir\.env"
$GenerateEnv = $false

if (Test-Path $EnvFile) {
    Write-Info ".env already exists — keeping existing secrets."
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") { [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2]) }
    }
} else {
    $JwtSecret      = New-HexSecret
    $EncryptionKey  = New-HexSecret
    $NextAuthSecret = New-HexSecret
    $GenerateEnv    = $true
}

# ── 5/7  prompt for optional values ───────────────────────────────────────
if ($GenerateEnv) {
    $OpenAiKey       = Read-Host "Enter your OpenAI API key    (press Enter to skip)"
    $AlphaVantageKey = Read-Host "Enter your Alpha Vantage key (press Enter to skip)"
    $NextAuthUrl     = Read-Host "Public URL of this install   (default: http://localhost)"
    if (-not $NextAuthUrl) { $NextAuthUrl = "http://localhost" }

# ── 6/7  write .env ───────────────────────────────────────────────────────
    Write-Info "[6/7] Writing $EnvFile..."
    @"
JWT_SECRET=$JwtSecret
ENCRYPTION_KEY=$EncryptionKey
NEXTAUTH_SECRET=$NextAuthSecret
NEXTAUTH_URL=$NextAuthUrl
OPENAI_API_KEY=$OpenAiKey
ALPHA_VANTAGE_KEY=$AlphaVantageKey
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=noreply@agentfloor.local
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
"@ | Set-Content $EnvFile -Encoding UTF8

    # Restrict .env to current user only (equivalent to chmod 600)
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User,
        "Modify", "Allow")
    $acl.AddAccessRule($rule)
    Set-Acl $EnvFile $acl
} else {
    Write-Info "[6/7] Using existing .env."
}

# ── 7/7  start the stack ───────────────────────────────────────────────────
Write-Info "[7/7] Starting AgentFloor..."
docker compose --env-file $EnvFile -f "$InstallDir\docker-compose.yml" up -d

Write-Info "Waiting for AgentFloor to be ready (up to 90s)..."
$Timeout = 90; $Elapsed = 0
while ($true) {
    try {
        $r = Invoke-WebRequest "http://localhost/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($r.StatusCode -eq 200) { break }
    } catch {}
    Start-Sleep 2; $Elapsed += 2
    if ($Elapsed -ge $Timeout) { Write-Fatal "Timed out. Check logs with: docker compose --env-file $EnvFile -f $InstallDir\docker-compose.yml logs" }
}

# ── install agentfloor function into PowerShell profile ───────────────────
$ProfileDir = Split-Path $PROFILE
if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null }
if (-not (Test-Path $PROFILE))    { New-Item -ItemType File      -Force -Path $PROFILE    | Out-Null }

$AliasBlock = @'

# AgentFloor management function — added by installer
function agentfloor {
    param([string]$Command, [Parameter(ValueFromRemainingArguments=$true)][string[]]$Rest)
    $ef = "$env:USERPROFILE\.agentfloor\.env"
    $dc = "$env:USERPROFILE\.agentfloor\docker-compose.yml"
    switch ($Command) {
        "update" {
            docker compose --env-file $ef -f $dc pull
            docker compose --env-file $ef -f $dc up -d
        }
        "logs"   { docker compose --env-file $ef -f $dc logs -f }
        default  { docker compose --env-file $ef -f $dc $Command @Rest }
    }
}
'@

if (-not (Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue | Select-String "AgentFloor management function")) {
    Add-Content $PROFILE $AliasBlock
}

# ── success banner ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  AgentFloor is running!" -ForegroundColor White
Write-Host "  Open http://localhost and register your admin account." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Useful commands (restart PowerShell first):" -ForegroundColor White
Write-Host "    agentfloor update    pull the latest version"
Write-Host "    agentfloor logs      stream logs"
Write-Host "    agentfloor stop      shut down"
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
