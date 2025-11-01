const logContainer = document.getElementById('log-container');
const wsBadge = document.getElementById('wsStatus');
const txBadge = document.getElementById('txStatus');
const broadcastButton = document.getElementById('broadcastButton');
const sendMessageButton = document.getElementById('sendMessageButton');
const modeSwitch   = document.getElementById('modeSwitch');
const switchLabel  = document.getElementById('switchLabel');

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let ws;
let wsOk = false;
let wsText = 'Déconnecté'; 
let broadcasting = false;

let broadcastingIntervalId = null;
let broadcastingIntervalMs = 100; // 10 Hz

let countdownDurationS = 3;

// [AJOUTER] état et utilitaires pour enregistrement de geste
let gestureActive = false;
let countdownTimers = [];
let audioCtx = null;

function playBeep(volume = 1, durationMs = 300, freq = 880) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, audioCtx.currentTime);
    g.gain.setValueAtTime(volume, audioCtx.currentTime);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    setTimeout(() => { try { o.stop(); } catch (e) {} }, durationMs);
  } catch (e) {
    // fallback silencieux si WebAudio inaccessible
    console.warn('WebAudio failed:', e);
  }
}

function clearCountdown() {
  while (countdownTimers.length) {
    clearTimeout(countdownTimers.shift());
  }
}
function countdown() {
  clearCountdown();
  for (let i = 0; i < countdownDurationS+1; i++) {
    const t = setTimeout(() => {
      if (i === countdownDurationS) {
        logSys(`Go! ⭕️`);
        playBeep(1.5, 320, 880);
      } else {
        logSys(`${countdownDurationS - i}...`);
        playBeep(0.35, 120, 620);
      }
    }, i * 1000);
    countdownTimers.push(t);
  }
}

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

function updateUI() {
  // update connection state
  wsBadge.textContent = wsText || (wsOk ? 'Connecté' : 'Déconnecté');
  wsBadge.classList.toggle('ok', wsOk);
  wsBadge.classList.toggle('err', !wsOk);

  // update mode label
  switchLabel.textContent = modeSwitch.checked ? 'Recording' : 'Broadcasting';

  // update tx state
  txBadge.textContent = broadcasting ? 'Diffusion active' : 'Diffusion inactive';
  txBadge.classList.toggle('ok', broadcasting);
  txBadge.classList.toggle('err', false);
  if (modeSwitch.checked) {
    broadcastButton.textContent = broadcasting ? 'Stop' : 'Enregistrer un geste';
  } else {
    broadcastButton.textContent = broadcasting ? 'Stopper la diffusion' : 'Lancer la diffusion';
  }
  broadcastButton.classList.toggle('primary', !broadcasting);
  broadcastButton.classList.toggle('stop', broadcasting);
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

// ---- websocket ----
function connectWS() {
  wsOk = false; wsText = 'Connexion…';
  ws = new WebSocket(wsUrl);
  updateUI();

  ws.addEventListener('open', () => {
    wsOk = true; wsText = 'Connecté';
    logSys('WebSocket ouvert.');
    updateUI();
  });

  ws.addEventListener('message', (ev) => {
    logIn(ev.data);
  });

  ws.addEventListener('close', () => {
    wsOk = false; wsText = 'Déconnecté';
    logSys('WebSocket fermé.');
    if (broadcasting) setTimeout(connectWS, 1000);
    updateUI();
  });

  ws.addEventListener('error', () => {
    wsOk = false; wsText = 'Erreur';
    logSys('Erreur WebSocket.');
    updateUI();
  });
}

function sendPing() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const msg = JSON.stringify({ type: 'message', message: "ping" });
    ws.send(msg);
    logOut(msg);
  } else {
    logSys('WebSocket non connecté.');
  }
}

function sendSensorSnapshot() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const mode = gestureActive ? 'record' : (modeSwitch && modeSwitch.checked ? 'record' : 'stream');
    const msg = JSON.stringify({ type: 'sensorSnapshot', mode, data: sensorSnapshot });
    ws.send(msg);
    logOut('sensorSnapshot ' + msg);
  } else {
    logSys('WebSocket non connecté.');
  }
}

// ---- ui events ----
modeSwitch.addEventListener('change', updateUI);

broadcastButton.addEventListener('click', async () => {
  // ---- gesture ----
  if (modeSwitch.checked) {
    if (gestureActive) {
      stopSensorListeners();
      if (broadcastingIntervalId) { clearInterval(broadcastingIntervalId); broadcastingIntervalId = null; }

      if (ws && ws.readyState === WebSocket.OPEN) {
        const ctrl = JSON.stringify({ type: 'control', action: 'gesture_end' });
        ws.send(ctrl);
        logOut(ctrl);
      } else {
        logSys('WebSocket non connecté (impossible d\'envoyer gesture_end).');
      }

      gestureActive = false;
      broadcasting = false;

      updateUI();
      return;
    } else {
      if (!(ws && ws.readyState === WebSocket.OPEN)) {
        logSys('WebSocket non connecté. Impossible de lancer l\'enregistrement.');
        return;
      }

      const permissionGranted = await requestSensorPermissions();
      if (!permissionGranted) {
        logSys('Permissions capteurs refusées — annulation de l\'enregistrement.');
        return;
      }

      const startMsg = JSON.stringify({ type: 'control', action: 'gesture_start' });
      ws.send(startMsg);
      logOut(startMsg);
      
      countdown();
      const afterCountdown = setTimeout(async () => {
        if (!permissionGranted) {
          logSys('Permissions capteurs refusées — annulation de l\'enregistrement.');
          if (ws && ws.readyState === WebSocket.OPEN) {
            const endMsg = JSON.stringify({ type: 'control', action: 'gesture_end' });
            ws.send(endMsg);
            logOut(endMsg);
          }
          clearCountdown();
          updateUI();
          return;
        }

        startSensorListeners();
        gestureActive = true;
        broadcasting = true;
        if (!ws || ws.readyState === WebSocket.CLOSED) connectWS();
        if (broadcastingIntervalId) clearInterval(broadcastingIntervalId);
        broadcastingIntervalId = setInterval(sendSensorSnapshot, broadcastingIntervalMs);
        updateUI();
      }, (countdownDurationS+1) * 1000);
      countdownTimers.push(afterCountdown);

      updateUI();
      return;
    }
  // ---- regular ----
  } else {
    broadcasting = !broadcasting;

    if (!broadcasting) {
      stopSensorListeners();
      
      if (broadcastingIntervalId) clearInterval(broadcastingIntervalId);
      broadcastingIntervalId = null;
    } else {
      const permissionGranted = await requestSensorPermissions();
      if (!permissionGranted) {
        logSys('Impossible de lancer la diffusion!');
        updateUI();
        return;
      }
      startSensorListeners();
      if (!ws || ws.readyState === WebSocket.CLOSED) connectWS();
      sendPing();
      broadcastingIntervalId = setInterval(sendSensorSnapshot, broadcastingIntervalMs);
    }
    updateUI();
    return;
  }
});

sendMessageButton.addEventListener('click', sendPing);

requestSensorPermissions();
connectWS();
updateUI();
