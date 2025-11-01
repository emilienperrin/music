from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from datetime import datetime

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return HTMLResponse('<meta http-equiv="refresh" content="0; URL=/static/index.html">')

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client = websocket.client
    print(f"[WS] Client connecté: {client.host}:{client.port}")
    try:
        while True:
            data = await websocket.receive_text()
            stamp = datetime.now().strftime("%H:%M:%S")
            print(f"[{stamp}] ← {data}")
            response_text = "pong" if data == "ping" else ("salut" if data == "bonjour" else "")
            if response_text:
                await websocket.send_text(response_text)
                print(f"[{stamp}] → {response_text}")
    except WebSocketDisconnect:
        print(f"[WS] Client déconnecté: {client.host}:{client.port}")