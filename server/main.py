from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from datetime import datetime, timezone
from pathlib import Path
import json
import csv
import pandas as pd

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

RECORDINGS_DIR = Path("recordings")
RECORDINGS_DIR.mkdir(exist_ok=True)

@app.get("/")
async def root():
    return HTMLResponse('<meta http-equiv="refresh" content="0; URL=/static/index.html">')

def _g(obj, *keys):
    """Safe nested get from dict."""
    cur = obj
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur

def _getCSV(csv_path):
    """Open CSV file and return writer, creating header if needed."""
    csv_file = open(csv_path, "a", newline="", encoding="utf-8")
    csv_writer = csv.writer(csv_file)
    if csv_path.stat().st_size == 0:
        csv_writer.writerow([
            "server_ts", "client_ts",
            "accel_x", "accel_y", "accel_z",
            "gyro_alpha", "gyro_beta", "gyro_gamma",
            "mag_heading", "mag_source",
        ])
    return csv_file, csv_writer

class sensorSnapshot:
    def __init__(self):
        self.accel = { 'x': None, 'y': None, 'z': None }
        self.gyro  = { 'alpha': None, 'beta': None, 'gamma': None }
        self.mag   = { 'heading': None, 'source': None }
        self.ts    = None
    
    def getRow(self):
        return [
            self.serverTs, self.ts,
            self.accel['x'], self.accel['y'], self.accel['z'],
            self.gyro['alpha'], self.gyro['beta'], self.gyro['gamma'],
            self.mag['heading'], self.mag['source'],
        ]
    
    @staticmethod
    def fromPayload(payload, serverTs=None):
        snap = sensorSnapshot()
        if serverTs:
            snap.serverTs = serverTs
        snap.ts            = pd.Timestamp.fromtimestamp(payload.get('ts', 0) / 1000.0, tz='Europe/Paris').strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        snap.accel['x']    = payload.get('accel', {}).get('x')
        snap.accel['y']    = payload.get('accel', {}).get('y')
        snap.accel['z']    = payload.get('accel', {}).get('z')
        snap.gyro['alpha'] = payload.get('gyro', {}).get('alpha')
        snap.gyro['beta']  = payload.get('gyro', {}).get('beta')
        snap.gyro['gamma'] = payload.get('gyro', {}).get('gamma')
        snap.mag['heading']= payload.get('mag', {}).get('heading')
        snap.mag['source'] = payload.get('mag', {}).get('source')
        return snap

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client = websocket.client
    print(f"[WS] Client connecté: {client.host}:{client.port}")

    client_id = f"{client.host}"
    client_dir = RECORDINGS_DIR / client_id
    client_dir.mkdir(parents=True, exist_ok=True)

    session_name = pd.Timestamp.now(tz='Europe/Paris').strftime("%Y%m%d_%H%M%S")
    csv_path = client_dir / f"snapshots_{session_name}.csv"

    # open CSV file (append) and write header if new file
    try:
        csv_file, csv_writer = _getCSV(csv_path)        
    except Exception as e:
        print(f"[WS] Erreur ouverture CSV pour {client_id}: {e}")

    try:
        while True:
            data = await websocket.receive_text()
            stamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{stamp}] ← {data}")

            # basic replies (ping / bonjour)
            try:
                obj = json.loads(data)
                if isinstance(obj, dict) and obj.get("type") == "message":
                    data = obj.get("message", "")
                    if data == "ping":
                        response_text = "pong"
                    if response_text:
                        await websocket.send_text(response_text)
                        print(f"[{stamp}] → {response_text}")
                elif isinstance(obj, dict) and obj.get("type") == "sensorSnapshot":
                    mode = obj.get("mode")
                    payload = obj.get("data") or {}

                    if mode == "record" and csv_writer is not None:
                        server_ts = pd.Timestamp.now(tz='Europe/Paris').strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                        snap = sensorSnapshot.fromPayload(payload, serverTs=server_ts)
                        csv_writer.writerow(snap.getRow())
                        try:
                            csv_file.flush()
                        except Exception:
                            pass
            except Exception:
                print(f"[WS] Erreur traitement message de {client_id}")
                pass
    except WebSocketDisconnect:
        print(f"[WS] Client déconnecté: {client.host}:{client.port}")
    finally:
        try:
            if csv_file: csv_file.close()
        except Exception:
            pass