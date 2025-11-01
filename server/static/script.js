const logContainer = document.getElementById('log-container');
const wsBadge = document.getElementById('wsStatus');
const txBadge = document.getElementById('txStatus');
const broadcastButton = document.getElementById('broadcastButton');
const sendMessageButton = document.getElementById('sendMessageButton');

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
let ws;
let broadcasting = false;
let intervalId = null;

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

broadcastButton.addEventListener('click', () => {
  broadcasting = !broadcasting;
  setTxState(broadcasting);

  if (broadcasting) {
    sendPing();
    intervalId = setInterval(sendPing, 10000);
    if (!ws || ws.readyState === WebSocket.CLOSED) connectWS();
  } else {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
});

sendMessageButton.addEventListener('click', sendPing);

connectWS();
setTxState(false);
