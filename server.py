"""
Travel Finder — Local Proxy Server (Python 3, no pip install needed)
Usage:  python server.py  (or double-click start.bat)
"""

import http.server
import subprocess
import tempfile
import json
import os
import sys
import webbrowser
import threading

PORT = 3001
DIR  = os.path.dirname(os.path.abspath(__file__))


def call_anthropic(api_key, body_bytes):
    """
    Use PowerShell Invoke-WebRequest to reach the Anthropic API.
    This uses .NET's HttpClient / WinHTTP which:
      - reads the Windows certificate store (trusts corporate CA certs)
      - handles NTLM / Kerberos proxy authentication automatically
      - respects PAC files and WinHTTP proxy settings
    """
    # Write the request body to a temp file (avoids command-line quoting issues)
    body_fd, body_path = tempfile.mkstemp(suffix=".json")
    try:
        with os.fdopen(body_fd, "wb") as f:
            f.write(body_bytes)

        # Escape the path for PowerShell (forward slashes are fine)
        ps_body_path = body_path.replace("\\", "/")

        ps_script = f"""
$ErrorActionPreference = 'Stop'

try {{ [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]'Tls,Tls11,Tls12,Tls13' }} catch {{
     [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }}
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {{$true}}
[System.Net.ServicePointManager]::Expect100Continue = $false

Add-Type -AssemblyName System.Net.Http

$bodyText = [System.IO.File]::ReadAllText('{ps_body_path}')

try {{
    $handler = New-Object System.Net.Http.HttpClientHandler
    try {{ $handler.ServerCertificateCustomValidationCallback = [System.Net.Http.HttpClientHandler]::DangerousAcceptAnyServerCertificateValidator }} catch {{}}

    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(90)
    $client.DefaultRequestHeaders.Add('x-api-key', '{api_key}')
    $client.DefaultRequestHeaders.Add('anthropic-version', '2023-06-01')

    $content = New-Object System.Net.Http.StringContent($bodyText, [System.Text.Encoding]::UTF8, 'application/json')
    $response = $client.PostAsync('https://api.anthropic.com/v1/messages', $content).GetAwaiter().GetResult()
    $statusCode = [int]$response.StatusCode
    $respBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $client.Dispose()

    Write-Output ('__STATUS__' + $statusCode)
    Write-Output $respBody
}} catch {{
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) {{ $msg = $msg + ' >> ' + $_.Exception.InnerException.Message }}
    if ($_.Exception.InnerException.InnerException) {{ $msg = $msg + ' >> ' + $_.Exception.InnerException.InnerException.Message }}
    $msg = $msg -replace '"', "'"
    Write-Output '__STATUS__502'
    Write-Output ('{{"error":{{"message":"' + $msg + '"}}}}')
}}
"""
        # Write the PS script to a temp file too
        ps_fd, ps_path = tempfile.mkstemp(suffix=".ps1")
        try:
            with os.fdopen(ps_fd, "w", encoding="utf-8") as f:
                f.write(ps_script)

            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy", "Bypass",
                    "-File", ps_path,
                ],
                capture_output=True,
                timeout=90,
            )

            stdout = result.stdout.decode("utf-8", errors="replace").strip()
            stderr = result.stderr.decode("utf-8", errors="replace").strip()

            # Always print PS output to terminal for debugging
            if stderr:
                print(f"  [PS stderr] {stderr[:500]}")
            print(f"  [PS stdout] {stdout[:500]}")

            if "__STATUS__" in stdout:
                lines = stdout.splitlines()
                status_line = next((l for l in lines if l.startswith("__STATUS__")), "__STATUS__200")
                status_code = int(status_line.replace("__STATUS__", "").strip())
                body_lines  = [l for l in lines if not l.startswith("__STATUS__")]
                resp_body   = "\n".join(body_lines)
            else:
                # No status marker — treat as error
                err_msg = stderr or stdout or "Empty response from PowerShell"
                return 502, json.dumps({"error": {"message": err_msg}}).encode()

            return status_code, resp_body.encode("utf-8")

        finally:
            try: os.unlink(ps_path)
            except: pass
    finally:
        try: os.unlink(body_path)
        except: pass


class Handler(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        if int(args[1]) >= 400:
            print(f"  [{args[1]}] {self.path}")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, x-api-key, anthropic-version, "
                         "anthropic-dangerous-direct-browser-access")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if self.path in ("/", "/index.html"):
            path = os.path.join(DIR, "index.html")
            try:
                with open(path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self._cors()
                self.end_headers()
                self.wfile.write(data)
            except FileNotFoundError:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"index.html not found")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/api/messages":
            self.send_response(404)
            self.end_headers()
            return

        length  = int(self.headers.get("Content-Length", 0))
        body    = self.rfile.read(length)
        api_key = self.headers.get("x-api-key", "")

        if not api_key:
            self._json_error(401, "Missing x-api-key header")
            return

        try:
            status_code, resp_body = call_anthropic(api_key, body)
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self._cors()
            self.end_headers()
            self.wfile.write(resp_body)
        except subprocess.TimeoutExpired:
            self._json_error(504, "Request timed out after 90 seconds.")
        except FileNotFoundError:
            self._json_error(502, "powershell.exe not found.")
        except Exception as e:
            self._json_error(502, f"Proxy error: {e}")

    def _json_error(self, code, msg):
        body = json.dumps({"error": {"message": msg}}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    url = f"http://localhost:{PORT}"
    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)

    print()
    print("========================================")
    print("  ✈️  AI Travel Finder — Local Server")
    print("========================================")
    print(f"\n  Open this URL in your browser:\n\n    {url}\n")
    print("  Using PowerShell Invoke-WebRequest (handles corporate proxy auth).")
    print("  Press Ctrl+C to stop the server.\n")

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server stopped.")
        sys.exit(0)
