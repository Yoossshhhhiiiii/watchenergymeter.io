#!/bin/zsh
cd "${0:A:h}" || exit 1
python3 - <<'PY'
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import webbrowser
with ThreadingHTTPServer(('127.0.0.1', 0), SimpleHTTPRequestHandler) as server:
    address = f'http://127.0.0.1:{server.server_port}/'
    print(f'指針抄錶台 {address}　關閉此視窗即可結束。', flush=True)
    webbrowser.open(address)
    server.serve_forever()
PY
