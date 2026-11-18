document.getElementById('check').onclick = async () => {
  const output = document.getElementById('result');
  const pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.cloudflare.com:3478'}]});
  const events = [];
  const render = () => { output.textContent = JSON.stringify({state: pc.iceGatheringState, events}, null, 2); };
  pc.onicecandidate = ({candidate}) => { if (candidate) events.push({type: candidate.type, protocol: candidate.protocol}); render(); };
  pc.onicecandidateerror = e => { events.push({error: e.errorCode}); render(); };
  pc.createDataChannel('network-check');
  await pc.setLocalDescription(await pc.createOffer());
  render();
  setTimeout(() => { render(); pc.close(); }, 10000);
};

document.getElementById('socket').onclick = () => {
 const out = document.getElementById('socket-result');
 const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/echo');
 ws.onmessage = e => out.textContent = e.data;
 ws.onerror = () => out.textContent = 'WebSocket failed';
 ws.onclose = e => out.textContent += ' Close code ' + e.code;
};
