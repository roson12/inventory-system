# Starts the full stack, applies pending migrations, prints access URLs,
# and stops the services when this script is interrupted (Ctrl+C).
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$webPort = if ($env:WEB_PORT) { $env:WEB_PORT } else { "8080" }
$apiPort = if ($env:API_PORT) { $env:API_PORT } else { "4000" }

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker is required but was not found in PATH."
}

if (-not (Test-Path ".env")) {
    Write-Host "No .env found; creating one from .env.example."
    Copy-Item ".env.example" ".env"
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    (Get-Content ".env") -replace "^SESSION_SECRET=.*", "SESSION_SECRET=$secret" | Set-Content ".env"
    Write-Host "Review .env before using this in production."
}

$stopped = $false
function Stop-Services {
    if (-not $script:stopped) {
        $script:stopped = $true
        Write-Host ""
        Write-Host "Stopping services..."
        docker compose stop
        Write-Host "Services stopped. Data volumes are preserved."
    }
}

try {
    [Console]::TreatControlCAsInput = $false
    $null = Register-EngineEvent PowerShell.Exiting -Action { Stop-Services }

    Write-Host "Building and starting containers..."
    docker compose up -d --build

    Write-Host "Waiting for the API health check..."
    $healthy = $false
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$webPort/api/health" -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { $healthy = $true; break }
        } catch { Start-Sleep -Seconds 2 }
    }

    if (-not $healthy) {
        docker compose logs api --tail=80
        throw "API did not become healthy."
    }

    Write-Host "Applying pending Prisma migrations..."
    docker compose exec -T api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

    docker compose ps

    Write-Host ""
    Write-Host "Inventory Management System is running."
    Write-Host "  Web application : http://localhost:$webPort"
    Write-Host "  API health      : http://localhost:$webPort/api/health"
    Write-Host "  API docs        : http://localhost:$webPort/api/docs"
    Write-Host "  API (dev port)  : http://localhost:$apiPort (only with compose.dev.yaml)"
    Write-Host ""
    Write-Host "Create the initial Super Admin once (prompts for the password):"
    Write-Host "  docker compose exec -it api node apps/api/dist/scripts/create-super-admin.js ``"
    Write-Host "    --email you@example.com --name `"Super Admin`""
    Write-Host ""
    Write-Host "Demo accounts (only after seeding):"
    Write-Host "  admin@example.com / Admin123!Pass"
    Write-Host "  staff@example.com / Staff123!Pass"
    Write-Host "  customer@example.com / Customer123!Pass"
    Write-Host ""
    Write-Host "Press Ctrl+C to stop all services."

    docker compose logs -f
}
finally {
    Stop-Services
}
