param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$CertificateThumbprint,
    [Parameter(Mandatory=$true)][string]$FileToSign,
    [string]$TimestampUrl = 'https://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
try {
    $file = Get-Item -LiteralPath $FileToSign
    if ($file.Extension -ne '.exe') { throw 'Only release executables may be signed.' }
    $cert = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
    if (!$cert.HasPrivateKey -or $cert.NotAfter -le (Get-Date) -or $cert.NotBefore -gt (Get-Date)) { throw 'A valid signing certificate with an accessible private key is required.' }
    if ($cert.Subject -eq $cert.Issuer) { throw 'Self-signed certificates are not accepted for public releases.' }
    $usage = @($cert.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId.Value })
    if ($usage -notcontains '1.3.6.1.5.5.7.3.3') { throw 'The certificate must permit code signing.' }
    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        if (!$chain.Build($cert)) { throw 'The signing certificate chain is not trusted or could not be validated.' }
    } finally { $chain.Dispose() }
    $tool = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($tool) { $signTool = $tool.Source } else {
        $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
        $signTool = Get-ChildItem -LiteralPath $sdk -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (!$signTool) { throw 'Install the Windows SDK signing tools on the signing host.' }
    & $signTool sign /sha1 $CertificateThumbprint /s My /fd SHA256 /tr $TimestampUrl /td SHA256 /d 'Free Scribd Downloader' $file.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
    & $signTool verify /pa /all $file.FullName
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint -or !$signature.TimeStamperCertificate) { throw 'The expected valid timestamped publisher signature was not found.' }
} catch {
    Write-Error $_
    exit 1
}
