# Minimal local POST receiver, for getting a large computed JSON result OUT of a browser
# tab and back into a file this session can read.
#
# WHY THIS EXISTS: javascript_tool's return value has a hard size ceiling (observed failing
# around ~130,000 characters of RESPONSE text - which a raw JS string well under that in its
# own length can still exceed once the tool's own JSON-encodes it). Above the ceiling the
# tool auto-saves the full result to a local .txt file instead of erroring cleanly, but that
# file is the tool's own {type,text} envelope, DOUBLE JSON-encoded around your actual
# payload - unwrapping it reliably from PowerShell is fiddly and wastes real time.
# POSTing the payload out of the page to a tiny local server and reading the file it wrote
# is far more reliable for anything over a few tens of KB (a rebuilt rivalry.h2h easily
# clears 300-500KB).
#
# Deliberately does ONLY ONE thing - always writes the POST body to the SAME fixed file,
# unconditionally. An earlier version of this script parsed the request path to name the
# output file per-call (so multiple payloads could be saved under different names) and used
# [System.Web.HttpUtility]::UrlDecode to do it - that type is not loaded in a default
# PowerShell session (`Unable to find type [System.Web.HttpUtility]`), the decode silently
# produced an empty filename, and every POST wrote to a bare, filename-less path with no
# visible error. If you need to distinguish multiple payloads, run this on a different
# -Port per payload (see Usage below) rather than reintroducing path-based naming.
#
# Usage:
#   powershell -File save-server.ps1 -Port 8802 -OutFile C:\...\scratch\payload.json
#   # then from the SAME-ORIGIN page (served by a normal static server, e.g. Serve-Repo.ps1):
#   #   await fetch('http://localhost:8802/', { method: 'POST', body: JSON.stringify(x) })
#   # CORS is wide open (Access-Control-Allow-Origin: *) since this only ever runs on
#   # localhost for a single throwaway computation - never expose this port beyond that.

param(
    [int]$Port = 8802,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Save server on http://localhost:$Port/  ->  $OutFile"

while ($true) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $res.Headers.Add("Access-Control-Allow-Origin", "*")
    $res.Headers.Add("Access-Control-Allow-Methods", "POST, OPTIONS")
    $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
    if ($req.HttpMethod -eq "OPTIONS") { $res.StatusCode = 204; $res.OutputStream.Close(); continue }

    $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
    $body = $reader.ReadToEnd()
    [IO.File]::WriteAllText($OutFile, $body, (New-Object Text.UTF8Encoding($false)))

    $msg = "OK bytes=" + $body.Length
    $bytes = [Text.Encoding]::UTF8.GetBytes($msg)
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
    Write-Output $msg
}
