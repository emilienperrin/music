from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from datetime import datetime, timezone
from pathlib import Path
import json
import csv
import pandas as pd
import traceback
import os

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

PROJECT_FOLDER = str(Path(__file__).parent.parent)
GESTURES_DIR = f'{PROJECT_FOLDER}/data/gestures'
os.makedirs(GESTURES_DIR, exist_ok=True)

gesturesMaster_path = f'{PROJECT_FOLDER}/data/gestures.csv'

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
    if Path(csv_path).stat().st_size == 0:
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

class Gesture:
    @staticmethod
    def currentId():
        if not os.path.exists(gesturesMaster_path):
            df = pd.DataFrame(columns=["gesture_id","client_id","start_ts","file_path"])
            df.to_csv(gesturesMaster_path, index=False)
            return 0
        try:
            df = pd.read_csv(gesturesMaster_path)
            if df.empty:
                return 0
            return int(df["gesture_id"].max()) + 1
        except Exception:
            return 0

    def __init__(self, client_id):
        self.id = Gesture.nextId()
        self.client_id = client_id
        datenow = datetime.now(timezone.utc)
        self.start_ts = datenow.strftime("%Y-%m-%d %H:%M:%S")
        filename = f"gesture_{self.id}.csv"
        self.path = f'{GESTURES_DIR}/{filename}'

        self.csv_file, self.csv_writer = _getCSV(self.path)

        self.register_gesture()
        
    def register_gesture(self):
        try:
            with open(gesturesMaster_path, "a", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow([self.id, self.client_id, self.start_ts, self.path])
        except Exception as e:
            print(f"[WS] Erreur enregistrement gesture index: {e}")

    def write(self, snapshot: sensorSnapshot):
        self.csv_writer.writerow(snapshot.getRow())
        try:
            self.csv_file.flush()
        except Exception:
            pass
    
    def finish(self):
        self.csv_file.close()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client = websocket.client
    print(f"[WS] Client connecté: {client.host}:{client.port}")

    client_id = f"{client.host}"
    
    gesture = None
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
                elif isinstance(obj, dict) and obj.get("type") == "control":
                    action = obj.get("action")
                    if action == "gesture_start":
                        if not gesture is None:
                            print(f"[WS] gesture_start reçu mais un geste est déjà actif pour {client_id}")
                        else:
                            try:
                                gesture = Gesture(client_id)
                                print(f"[WS] gesture_start {gesture.id} for {client_id}")
                            except Exception as e:
                                gesture = None
                                print(f"[WS] erreur initialisation gesture for {client_id}: {e}")
                    elif action == "gesture_end":
                        if gesture is None:
                            print(f"[WS] gesture_end reçu mais aucun geste actif pour {client_id}")
                        else:
                            try:
                                try:
                                    gesture.finish()
                                except Exception:
                                    pass
                                print(f"[WS] gesture_end gesture_id={gesture.id} closed for {client_id}")
                            finally:
                                gesture = None
                elif isinstance(obj, dict) and obj.get("type") == "sensorSnapshot":
                    mode = obj.get("mode")
                    payload = obj.get("data") or {}

                    if mode == "record":
                        if gesture is not None:
                            server_ts = pd.Timestamp.now(tz='Europe/Paris').strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
                            snapshot = sensorSnapshot.fromPayload(payload, serverTs=server_ts)
                            try:
                                gesture.write(snapshot)
                            except Exception as e:
                                print(f"[WS] Erreur écriture snapshot gesture_id={gesture.get('gesture_id')} : {e}")
                        else:
                            print(f"[WS] snapshot en mode 'record' reçu mais pas de geste actif pour {client_id}")
            except Exception:
                err_traceback = traceback.format_exc()
                print(f"[WS] Erreur traitement message de {client_id}: \n{err_traceback}")
                pass
    except WebSocketDisconnect:
        print(f"[WS] Client déconnecté: {client.host}:{client.port}")
    finally:
        try:
            if gesture is not None:
                gesture.finish()
                print(f"[WS] gesture_id={gesture.id} closed for {client_id} on disconnect")
        except Exception:
            pass