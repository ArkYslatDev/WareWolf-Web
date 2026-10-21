const socket = io({ transports: ['websocket', 'polling'] });
let myName = "";
let myId = null;
let myAvatar = '👨';
let isHost = false;
let hasVoted = false;
let timerInterval = null;

let currentWitchAction = null; 
let witchUsed = false;

socket.on('connect', () => { myId = socket.id; });

function selectAvatar(el, emoji) {
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    myAvatar = emoji;
}

function createRoom(mode) {
    myName = document.getElementById('name-input').value.trim();
    if (!myName) return alert("Masukkan nama!");
    socket.emit('createRoom', { playerName: myName, avatar: myAvatar, mode: mode });
}

function joinRoom() {
    myName = document.getElementById('name-input').value.trim();
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (!myName) return alert("Masukkan nama!");
    if (!code) return alert("Masukkan kode room!");
    socket.emit('joinRoom', { roomCode: code, playerName: myName, avatar: myAvatar });
}

function startGame() { socket.emit('startGame'); }
function playAgain() { socket.emit('playAgain'); }

function sendAction(type, targetId) {
    socket.emit('nightAction', { targetId, actionType: type });
    
    if (type === 'kill' || type === 'check') {
        document.getElementById('target-list').innerHTML = '';
    }
    if (type === 'heal' || type === 'poison') {
        currentWitchAction = null;
        document.getElementById('target-list').innerHTML = '';
        document.getElementById('action-desc').innerText = "Ramuan telah digunakan. Menunggu...";
    }
}

function useWitchPotion(type) {
    if (witchUsed) return alert("Ramuan sudah habis!");
    
    currentWitchAction = type;
    const actionDesc = document.getElementById('action-desc');
    actionDesc.innerText = type === 'heal' ? "Pilih siapa yang mau disembuhkan:" : "Pilih siapa yang mau diracuni:";
    
    if (window.lastRoomState) {
        renderTargets(window.lastRoomState, type, false);
    }
}

function sendVote(targetId) {
    if (hasVoted) return;
    hasVoted = true;
    socket.emit('voteAction', targetId);
    document.getElementById('target-list').innerHTML = '<div style="padding:10px;color:#888;text-align:center;">Menunggu pemain lain...</div>';
}

function sendChat() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chatMessage', msg);
    input.value = '';
}

socket.on('roomUpdate', (room) => {
    window.lastRoomState = room;
    isHost = room.hostId === myId;
    
    const me = room.players.find(p => p.id === myId);
    if (me) witchUsed = me.witchUsed;

    document.getElementById('menu-section').classList.add('hidden');

    if (room.phase === 'lobby') {
        document.getElementById('lobby-section').classList.remove('hidden');
        document.getElementById('game-section').classList.add('hidden');
        document.getElementById('chat-section').classList.add('hidden');
        document.getElementById('room-code-display').innerText = room.roomCode;
        document.getElementById('mode-indicator').innerText = room.isBotMode ? "🤖 Mode Latihan Lawan Bot" : "👥 Mode Multiplayer";

        document.getElementById('player-list').innerHTML = room.players.map(p => 
            `<div class="player ${p.alive ? '' : 'dead'}">
                <div class="player-info">
                    <span class="player-avatar">${p.avatar}</span>
                    <span>${p.name}</span>
                    ${p.id===myId?'<span class="badge badge-you">Kamu</span>':''}
                    ${p.id===room.hostId?'<span class="badge badge-host">Host</span>':''}
                </div>
            </div>`
        ).join('');

        document.getElementById('start-btn').classList.toggle('hidden', !isHost);
        document.getElementById('waiting-msg').classList.toggle('hidden', isHost);
        stopTimerUI();
    } else {
        document.getElementById('lobby-section').classList.add('hidden');
        document.getElementById('game-section').classList.remove('hidden');
        document.getElementById('chat-section').classList.remove('hidden');

        if (room.timerEnd && room.phase !== 'end') startTimerUI(room.timerEnd, room.timerDuration);
        else stopTimerUI();

        updateGameUI(room);
        updateChatTabs(room);
    }
});

socket.on('gameStarted', (data) => {
    const me = data.players.find(p => p.id === myId);
    if (me) {
        let color = '#22c55e';
        if (me.role === 'Werewolf') color = '#ef4444';
        if (me.role === 'Penyihir') color = '#a855f7';
        if (me.role === 'Peramal') color = '#3b82f6';
        document.getElementById('role-info').innerHTML = `Peranmu: <b style="color:${color}">${me.role}</b>`;
    }
    hasVoted = false;
    currentWitchAction = null;
    witchUsed = false;
    
    document.getElementById('log-area').innerHTML = '';
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('play-again-btn').classList.add('hidden');
    document.getElementById('witch-panel').classList.add('hidden');
});

socket.on('botActionMsg', (msg) => {
    addLog(msg, '#a855f7');
});

function updateGameUI(room) {
    const me = room.players.find(p => p.id === myId);
    if (!me) return;

    const title = document.getElementById('phase-title');
    const actionArea = document.getElementById('action-area');
    const targetList = document.getElementById('target-list');
    const actionDesc = document.getElementById('action-desc');
    const witchPanel = document.getElementById('witch-panel');
    const btnHeal = document.getElementById('btn-heal');
    const btnPoison = document.getElementById('btn-poison');

    if (me.role === 'Penyihir' && me.alive && room.phase === 'night' && !witchUsed) {
        witchPanel.classList.remove('hidden');
        btnHeal.disabled = witchUsed;
        btnPoison.disabled = witchUsed;
    } else {
        witchPanel.classList.add('hidden');
    }

    if (room.phase === 'night') {
        title.innerText = `🌙 Malam ke-${room.nightCount}`;
        actionArea.classList.remove('hidden');
        
        if (!me.alive) {
            actionDesc.innerText = "Kamu sudah mati."; targetList.innerHTML = "";
        } else if (me.role === 'Werewolf') {
            actionDesc.innerText = "Pilih korban (Bunuh):";
            if(targetList.innerHTML === "") renderTargets(room, 'kill', true);
        } else if (me.role === 'Penyihir') {
            if (!currentWitchAction && targetList.innerHTML === "") {
                actionDesc.innerText = "Pilih ramuan di atas, atau istirahat.";
            }
        } else if (me.role === 'Peramal') {
            actionDesc.innerText = "Pilih siapa yang mau diperiksa:";
            if(targetList.innerHTML === "") renderTargets(room, 'check', false);
        } else {
            actionDesc.innerText = "Kamu tidur. Tutup matamu...";
            targetList.innerHTML = "";
        }
    } 
    else if (room.phase === 'day') {
        title.innerText = `☀️ Siang ke-${room.nightCount} (Diskusi)`;
        actionArea.classList.add('hidden');
    } 
    else if (room.phase === 'vote') {
        title.innerText = `🗳️ Waktunya Voting!`;
        actionArea.classList.remove('hidden');
        if (room.votes[myId]) hasVoted = true; else hasVoted = false;

        if (!me.alive) {
            actionDesc.innerText = "Kamu sudah mati."; targetList.innerHTML = "";
        } else if (hasVoted) {
            actionDesc.innerText = "Kamu sudah vote. Menunggu...";
            targetList.innerHTML = "";
        } else {
            actionDesc.innerText = "Pilih siapa yang mau digantung:";
            renderTargets(room, 'vote', false);
        }
    } 
    else if (room.phase === 'end') {
        title.innerText = `🏁 GAME OVER`;
        actionArea.classList.add('hidden');
        witchPanel.classList.add('hidden');
        document.getElementById('play-again-btn').classList.toggle('hidden', !isHost);
    }
}

function renderTargets(room, actionType, excludeWolves) {
    const targetList = document.getElementById('target-list');
    targetList.innerHTML = "";
    let count = 0;

    room.players.forEach(p => {
        if (!p.alive || p.id === myId) return;
        if (excludeWolves && p.role === 'Werewolf') return;
        count++;
        const div = document.createElement('div');
        div.className = 'player';
        
        let btnHtml = '';
        if (actionType === 'vote') {
            btnHtml = `<button class="target-btn" onclick="sendVote('${p.id}')">Vote</button>`;
        } else {
            btnHtml = `<button class="target-btn" onclick="sendAction('${actionType}','${p.id}')">Pilih</button>`;
        }

        div.innerHTML = `
            <div class="player-info"><span class="player-avatar">${p.avatar}</span><span>${p.name}</span></div>
            ${btnHtml}
        `;
        targetList.appendChild(div);
    });

    if (count === 0) targetList.innerHTML = `<div style="padding:10px;color:#888;text-align:center;">Tidak ada target.</div>`;
}

function startTimerUI(endTs, durationSec) {
    stopTimerUI();
    document.getElementById('timer-bar').classList.remove('hidden');
    const tick = () => {
        const remaining = Math.max(0, Math.ceil((endTs - Date.now()) / 1000));
        const pct = durationSec > 0 ? (remaining / durationSec) * 100 : 0;
        document.getElementById('timer-fill').style.width = pct + '%';
        document.getElementById('timer-text').textContent = remaining + 's';
        if (remaining <= 10) document.getElementById('timer-bar').classList.add('urgent');
        else document.getElementById('timer-bar').classList.remove('urgent');
        if (remaining <= 0) stopTimerUI();
    };
    tick();
    timerInterval = setInterval(tick, 200);
}

function stopTimerUI() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    document.getElementById('timer-bar').classList.add('hidden');
    document.getElementById('timer-fill').style.width = '100%';
}

function updateChatTabs(room) {
    const me = room.players.find(p => p.id === myId);
    if (!me) return;
    const label = document.getElementById('chat-channel-label');
    if (me.alive) {
        if (room.phase === 'night') {
            if (me.role === 'Werewolf') label.textContent = '🐺 WEREWOLF';
            else if (me.role === 'Penyihir' || me.role === 'Peramal') label.textContent = '🔮 SPECIAL';
            else label.textContent = 'PUBLIK (MUTE)';
        } else label.textContent = 'PUBLIK';
    } else label.textContent = '💀 MATI';
}

function addLog(msg, color = '#4ade80') {
    const log = document.getElementById('log-area');
    log.innerHTML += `<div style="color:${color}; margin-bottom:5px;">> ${msg}</div>`;
    log.scrollTop = log.scrollHeight;
}

socket.on('actionConfirmed', (msg) => addLog(msg));
socket.on('seerResult', ({ name, role }) => {
    const color = role === 'Werewolf' ? '#ef4444' : '#22c55e';
    addLog(`🔮 Hasil ramalan: ${name} adalah ${role}!`, color);
});

socket.on('nightResult', ({ deaths, saved }) => {
    document.getElementById('log-area').innerHTML = '';
    if (saved) addLog(`💚 Seseorang diselamatkan oleh Penyihir!`, '#3b82f6');
    
    if (deaths.length === 0) {
        addLog(`🌙 Tidak ada korban malam ini.`, '#facc15');
    } else {
        deaths.forEach(name => addLog(`🌙 ${name} ditemukan tewas.`, '#f87171'));
    }
    currentWitchAction = null;
});

socket.on('voteResult', ({ lynchedName, tie }) => {
    if (tie) addLog(`🗳️ Voting seri, tidak ada yang digantung.`, '#facc15');
    else if (lynchedName) addLog(`🗳️ ${lynchedName} digantung warga.`, '#f87171');
    hasVoted = false;
});

socket.on('errorMsg', (msg) => alert(msg));

socket.on('gameOver', ({ winner, room }) => {
    document.getElementById('phase-title').innerText = `🏁 GAME OVER`;
    addLog(`🏆 Pemenang: ${winner}`, 'gold');
    document.getElementById('action-area').classList.add('hidden');
    document.getElementById('witch-panel').classList.add('hidden');
    stopTimerUI();

    const list = document.getElementById('target-list');
    list.innerHTML = "<h3 style='text-align:center; margin-bottom:10px;'>Semua Peran:</h3>" + room.players.map(p => 
        `<div class="player">
            <div class="player-info"><span class="player-avatar">${p.avatar}</span><span>${p.name} ${p.alive ? '' : '(mati)'}</span></div>
            <span style="color:${p.role==='Werewolf'?'#ef4444':p.role==='Penyihir'?'#a855f7':p.role==='Peramal'?'#3b82f6':'#22c55e'}; font-weight:bold;">${p.role}</span>
        </div>`
    ).join('');

    if (isHost) document.getElementById('play-again-btn').classList.remove('hidden');
});

socket.on('chatMessage', (entry) => {
    const box = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg ' + entry.channel;
    const icon = entry.channel === 'wolf' ? '🐺 ' : entry.channel === 'dead' ? '💀 ' : entry.channel === 'special' ? '🔮 ' : '';
    div.innerHTML = `<span class="sender">${icon}${entry.sender}</span><br>${entry.text}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
});