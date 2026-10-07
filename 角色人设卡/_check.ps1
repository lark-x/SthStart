# Persona card word-count check: each card (starts with "## ") must be <= 2000 chars.
# Usage: & _check.ps1   (ASCII-only output to avoid PS 5.1 encoding issues)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fail = 0
Get-ChildItem $dir -Filter *.md | Where-Object { $_.Name -ne 'README.md' } | ForEach-Object {
    $text = Get-Content $_.FullName -Raw -Encoding UTF8
    $parts = [regex]::Split($text, '(?m)^## ')
    $i = 0
    foreach ($p in $parts) {
        $i++
        if ($i -eq 1) { continue }  # file header
        $name = ($p -split "`n")[0].Trim()
        $count = ($p -replace '\s', '' -replace '[|#*>`\-\[\]()]', '').Length
        if ($count -gt 2000) { $fail++ ; $status = 'FAIL' } else { $status = 'ok' }
        "{0,-6} {1,5}  {2} / {3}" -f $status, $count, $_.Name, $name
    }
}
""
if ($fail -gt 0) { "RESULT: $fail card(s) exceed 2000 chars" } else { "RESULT: all cards <= 2000 chars" }
