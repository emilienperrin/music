const logContainer = document.getElementById('log-container');
const wsBadge = document.getElementById('wsStatus');
const txBadge = document.getElementById('txStatus');
const broadcastButton = document.getElementById('broadcastButton');
const sendMessageButton = document.getElementById('sendMessageButton');

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let ws;
let broadcasting = false;

let streamingIntervalId = null;
let streamingIntervalMs = 100; // 10 Hz

const sensorSnapshot = {
  accel: { x: null, y: null, z: null },
  gyro:  { alpha: null, beta: null, gamma: null },
  mag:   { heading: null, source: null },
  ts:    null
};
function onDeviceMotion(ev) {
    updateSnapshotFromMotion(sensorSnapshot, ev);
  }
  function onDeviceOrientation(ev) {
    updateSnapshotFromOrientation(sensorSnapshot, ev);
  }

// ---- log ----
function addLogLine(type, text) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-line ${type} flash-${type}`;
  entry.textContent = `[${time}] ${text}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
  // flash
  setTimeout(() => entry.classList.remove(`flash-${type}`), 1000);
}
function logIn(text)  { addLogLine("in",  `← ${text}`); }
function logOut(text) { addLogLine("out", `→ ${text}`); }
function logSys(text) { addLogLine("sys", `→ ${text}`); }

// ---- ui ----
function setWsState(ok, text) {
  wsBadge.textContent = text || (ok ? 'Connecté' : 'Déconnecté');
  wsBadge.classList.toggle('ok', ok);
  wsBadge.classList.toggle('err', !ok);
}

function setTxState(active) {
  txBadge.textContent = active ? 'Diffusion active' : 'Diffusion inactive';
  txBadge.classList.toggle('ok', active);
  txBadge.classList.toggle('err', false);
  broadcastButton.textContent = active ? 'Stopper la diffusion' : 'Lancer la diffusion';
  broadcastButton.classList.toggle('primary', !active);
  broadcastButton.classList.toggle('stop', active);
}

// ---- iphone ----
async function requestSensorPermissions() {
  const needsDOMP = typeof DeviceMotionEvent !== 'undefined'
                 && typeof DeviceMotionEvent.requestPermission === 'function';
  const needsDOEP = typeof DeviceOrientationEvent !== 'undefined'
                 && typeof DeviceOrientationEvent.requestPermission === 'function';

  try {
    if (needsDOMP) {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') throw new Error('Permission mouvement refusée');
    }
    if (needsDOEP) {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') throw new Error('Permission orientation refusée');
    }
    logSys('Permissions capteurs accordées ✅');
    return true;
  } catch (e) {
    logSys('Permissions capteurs refusées ❌ : ' + (e && e.message ? e.message : e));
    return false;
  }
}

// ---- iphone motions ----
function startSensorListeners() {
  window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
}
function stopSensorListeners() {
  window.removeEventListener('devicemotion', onDeviceMotion);
  window.removeEventListener('deviceorientation', onDeviceOrientation);
}

function round(v) {
  return (typeof v === 'number' && isFinite(v)) ? Math.round(v * 1000) / 1000 : null;
}

function updateSnapshotFromMotion(snapshot, ev) {
  const a = ev.acceleration || {};
  snapshot.accel.x = round(a.x);
  snapshot.accel.y = round(a.y);
  snapshot.accel.z = round(a.z);

  const r = ev.rotationRate || {};
  snapshot.gyro.alpha = round(r.alpha);
  snapshot.gyro.beta  = round(r.beta);
  snapshot.gyro.gamma = round(r.gamma);

  snapshot.ts = Date.now();
}

function updateSnapshotFromOrientation(snapshot, ev) {
  if (typeof ev.webkitCompassHeading === 'number' && !isNaN(ev.webkitCompassHeading)) {
    snapshot.mag.heading = round(ev.webkitCompassHeading);
    snapshot.mag.source = 'webkit';
  } else if (ev.absolute === true && typeof ev.alpha === 'number') {
    snapshot.mag.heading = round(ev.alpha);
    snapshot.mag.source = 'alpha';
  } else {
    snapshot.mag.heading = null;
    snapshot.mag.source = null;
  }

  snapshot.ts = Date.now();
}

// ---- streaming ----

// ---- websocket ----
function connectWS() {
  setWsState(false, 'Connexion…');
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setWsState(true, 'Connecté');
    logSys('WebSocket ouvert.');
  });

  ws.addEventListener('message', (ev) => {
    logIn(ev.data);
  });

  ws.addEventListener('close', () => {
    setWsState(false, 'Déconnecté');
    logSys('WebSocket fermé.');
    if (broadcasting) setTimeout(connectWS, 1000);
  });

  ws.addEventListener('error', () => {
    setWsState(false, 'Erreur');
    logSys('Erreur WebSocket.');
  });
}

function sendPing() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = 'ping';
    ws.send(msg);
    logOut(msg);
  } else {
    logSys('WebSocket non connecté.');
  }
}

function sendSensorSnapshot() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = JSON.stringify({ type: 'sensorSnapshot', data: sensorSnapshot });
    ws.send(msg);
    logOut('sensorSnapshot ' + msg);
  } else {
    logSys('WebSocket non connecté.');
  }
}

broadcastButton.addEventListener('click', async () => {
  if(broadcasting) { // stop broadcasting
    broadcasting = !broadcasting;
    setTxState(broadcasting);

    stopSensorListeners();
    
    if (streamingIntervalId) clearInterval(streamingIntervalId);
    streamingIntervalId = null;

  } else { // start broadcasting
    const permissionGranted = await requestSensorPermissions();
    if (!permissionGranted) {
      logSys('Impossible de lancer la diffusion!');
      return;
    }
    broadcasting = !broadcasting;
    setTxState(broadcasting);

    startSensorListeners();

    if (!ws || ws.readyState === WebSocket.CLOSED) connectWS();
    sendPing();
    streamingIntervalId = setInterval(sendSensorSnapshot, streamingIntervalMs);
  }
});

sendMessageButton.addEventListener('click', sendPing);

connectWS();
setTxState(false);
