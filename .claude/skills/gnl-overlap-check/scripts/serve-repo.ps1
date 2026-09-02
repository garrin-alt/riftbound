# Minimal static file server for index.html (and anything else placed under -Root).
#
# Needed because index.html's password gate depends on sessionStorage, and a bare `file://`
# page has that blocked - the app never gets past the lock screen. This is the same
# workaround used throughout this project's sessions; kept here as a canonical copy instead
# of re-deriving it from scratch each time.
param([int]$Port = 8790, [string]$Root = "C:\Users\Essam\riftbound")
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "Serving $Root on http://localhost:$Port/"
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $Root ($path.TrimStart('/'))
    if (Test-Path $file -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file)
        $ct = switch ($ext) {
            ".html" { "text/html; charset=utf-8" }
            ".js"   { "text/javascript; charset=utf-8" }
            ".css"  { "text/css; charset=utf-8" }
            ".json" { "application/json; charset=utf-8" }
            default { "application/octet-stream" }
        }
        $res.ContentType = $ct
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $res.StatusCode = 404
    }
    $res.OutputStream.Close()
}
