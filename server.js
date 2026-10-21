const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const TIMER_NIGHT = 30;
const TIMER_DAY = 30;
const TIMER_VOTE = 30;

// ==========================================
// FUNGSI UTILITY & TIMER (GLOBAL)
// ==========================================
function clearTimer(roomCode) {
    const room = rooms[roomCode];
    if (room && room.timer) {
        clearTimeout(room.timer); 
        room.timer = null; 
        room.timerEnd = null;
    }
}

function startPhaseTimer(roomCode, phase) {
    const room = rooms[roomCode];
    if (!room) return;
    clearTimer(roomCode);

    let duration = TIMER_NIGHT;
    if (phase === 'day') duration = TIMER_DAY;
    if (phase === 'vote') duration = TIMER_VOTE;

    room.timerDuration = duration;
    room.timerEnd = Date.now() + duration * 1000;

    room.timer = setTimeout(() => {
        if (!rooms[roomCode]) return;
        const r = rooms[roomCode];
        if (r.phase === 'night') resolveNight(roomCode);
        else if (r.phase === 'day') { 
            r.phase = 'vote'; 
            startPhaseTimer(roomCode, 'vote'); 
            broadcastRoom(roomCode); 
        }
        else if (r.phase === 'vote') resolveVote(roomCode);
    }, duration * 1000);
}

function broadcastRoom(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit('roomUpdate', {
        players: room.players, phase: room.phase, nightCount: room.nightCount,
        votes: room.votes, hostId: room.hostId, roomCode, isBotMode: room.isBotMode,
        timerEnd: room.timerEnd, timerDuration: room.timerDuration
    });
}

// ==========================================
// BOT AI LOGIC
// ==========================================
function processBotActions(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.players.forEach(bot => {
        if (!bot.isBot || !bot.alive) return;

        // Jeda acak agar bot tidak bergerak serentak (0.5 - 2.5 detik)
        const delay = Math.random() * 2000 + 500;

        setTimeout(() => {
            if (!rooms[roomCode] || rooms[roomCode].phase !== room.phase) return;
            const currentRoom = rooms[roomCode];

            if (currentRoom.phase === 'night') {
                if (bot.role === 'Werewolf' && !currentRoom.wolfTarget) {
                    const targets = currentRoom.players.filter(p => p.alive && p.role !== 'Werewolf' && p.id !== bot.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        currentRoom.wolfTarget = target.id;
                        io.to(roomCode).emit('botActionMsg', `🐺 Bot ${bot.name} telah memilih target.`);
                    }
                } else if (bot.role === 'Penyihir' && !bot.witchUsed && !currentRoom.witchAction) {
                    if (Math.random() > 0.5) {
                        const targets = currentRoom.players.filter(p => p.alive);
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        currentRoom.witchTarget = target.id;
                        currentRoom.witchAction = 'heal';
                        io.to(roomCode).emit('botActionMsg', `🧙‍♀️ Bot ${bot.name} menggunakan ramuan sembuh.`);
                    } else {
                        const targets = currentRoom.players.filter(p => p.alive && p.role !== 'Penyihir');
                        if (targets.length > 0) {
                            const target = targets[Math.floor(Math.random() * targets.length)];
                            currentRoom.witchTarget = target.id;
                            currentRoom.witchAction = 'poison';
                            io.to(roomCode).emit('botActionMsg', `🧙‍♀️ Bot ${bot.name} menggunakan ramuan racun.`);
                        }
                    }
                } else if (bot.role === 'Peramal') {
                    const targets = currentRoom.players.filter(p => p.alive && p.id !== bot.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        io.to(roomCode).emit('botActionMsg', `🔮 Bot ${bot.name} sedang meramal...`);
                    }
                }
            } 
            else if (currentRoom.phase === 'vote') {
                if (!currentRoom.votes[bot.id]) {
                    const targets = currentRoom.players.filter(p => p.alive && p.id !== bot.id);
                    if (targets.length > 0) {
                        const target = targets[Math.floor(Math.random() * targets.length)];
                        currentRoom.votes[bot.id] = target.id;
                        
                        const alivePlayers = currentRoom.players.filter(p => p.alive);
                        if (Object.keys(currentRoom.votes).length >= alivePlayers.length) {
                            clearTimer(roomCode);
                            resolveVote(roomCode);
                        } else {
                            broadcastRoom(roomCode);
                        }
                    }
                }
            }
        }, delay);
    });
}

// ==========================================
// KONEKSI SOCKET
// ==========================================
io.on('connection', (socket) => {
    socket.on('createRoom', ({ playerName, avatar, mode }) => {
        if (!playerName || playerName.trim() === '') return socket.emit('errorMsg', 'Nama kosong!');
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        rooms[roomCode] = {
            players: [], phase: 'lobby', nightCount: 0, votes: {}, 
            wolfTarget: null, witchTarget: null, witchAction: null,
            hostId: socket.id, isBotMode: (mode === 'bot'),
            timer: null, timerEnd: null, timerDuration: 0
        };
        joinRoom(socket, roomCode, playerName.trim(), avatar);
    });

    socket.on('joinRoom', ({ roomCode, playerName, avatar }) => {
        if (!roomCode || !rooms[roomCode]) return socket.emit('errorMsg', 'Room tidak ditemukan!');
        if (rooms[roomCode].phase !== 'lobby') return socket.emit('errorMsg', 'Game sudah berjalan!');
        if (rooms[roomCode].players.length >= 10) return socket.emit('errorMsg', 'Room penuh (Maks 10)!');
        const cleanName = playerName.trim();
        if (rooms[roomCode].players.some(p => p.name === cleanName)) return socket.emit('errorMsg', 'Nama sudah dipakai!');
        joinRoom(socket, roomCode, cleanName, avatar);
    });

    function joinRoom(socket, roomCode, playerName, avatar) {
        socket.join(roomCode);
        rooms[roomCode].players.push({ 
            id: socket.id, name: playerName, role: 'Warga', alive: true, avatar: avatar || '👤',
            witchUsed: false, isBot: false
        });
        socket.roomCode = roomCode;
        broadcastRoom(roomCode);
    }

    socket.on('startGame', () => {
        const roomCode = socket.roomCode;
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
        
        if (!room.isBotMode && room.players.length < 4) {
            return socket.emit('errorMsg', 'Minimal 4 pemain untuk mode Multiplayer!');
        }

        // Tambahkan Bot jika Mode Bot
        if (room.isBotMode) {
            const botNames = ['Budi', 'Siti', 'Joko', 'Rina', 'Andi'];
            const botAvatars = ['🤖', '👾', '👽', '🧟', '🎃'];
            const botsNeeded = 4 - room.players.length + 1; // Minimal total 5 pemain (1 user + 4 bot)

            for (let i = 0; i < botsNeeded; i++) {
                room.players.push({
                    id: 'bot_' + Math.random().toString(36).substring(2, 6),
                    name: 'Bot ' + (botNames[i] || 'X'),
                    role: 'Warga', alive: true, avatar: botAvatars[i] || '🤖',
                    witchUsed: false, isBot: true
                });
            }
        }

        // Distribusi Role
        const roles = [];
        const pCount = room.players.length;
        const wolfCount = Math.max(1, Math.floor(pCount / 4));
        
        for (let i = 0; i < wolfCount; i++) roles.push('Werewolf');
        if (pCount >= 5) { roles.push('Penyihir'); roles.push('Peramal'); }
        while (roles.length < pCount) roles.push('Warga');
        roles.sort(() => Math.random() - 0.5);

        room.players.forEach((p, i) => { 
            p.role = roles[i]; p.alive = true; p.witchUsed = false;
        });

        room.phase = 'night';
        room.nightCount = 1;
        room.votes = {};
        room.wolfTarget = null; room.witchTarget = null; room.witchAction = null;
        
        io.to(roomCode).emit('gameStarted', { players: room.players, roomCode });
        startPhaseTimer(roomCode, 'night');
        broadcastRoom(roomCode);

        if (room.isBotMode) processBotActions(roomCode);
    });

    socket.on('nightAction', ({ targetId, actionType }) => {
        const roomCode = socket.roomCode;
        const room = rooms[roomCode];
        if (!room || room.phase !== 'night') return;

        const player = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetId);
        if (!player || !player.alive || !target || !target.alive) return;

        if (actionType === 'kill' && player.role === 'Werewolf') {
            if (target.role === 'Werewolf') return socket.emit('errorMsg', 'Jangan bunuh rekanmu!');
            room.wolfTarget = targetId;
        } 
        else if (actionType === 'heal' && player.role === 'Penyihir') {
            if (player.witchUsed) return socket.emit('errorMsg', 'Ramuan sudah habis!');
            room.witchTarget = targetId;
            room.witchAction = 'heal';
        } 
        else if (actionType === 'poison' && player.role === 'Penyihir') {
            if (player.witchUsed) return socket.emit('errorMsg', 'Ramuan sudah habis!');
            room.witchTarget = targetId;
            room.witchAction = 'poison';
        } 
        else if (actionType === 'check' && player.role === 'Peramal') {
            socket.emit('seerResult', { name: target.name, role: target.role });
            return; 
        }

        socket.emit('actionConfirmed', `Aksi berhasil diproses.`);
        broadcastRoom(roomCode);

        if (actionType === 'kill') {
            clearTimer(roomCode);
            setTimeout(() => resolveNight(roomCode), 3000);
        }
    });

    socket.on('voteAction', (targetId) => {
        const roomCode = socket.roomCode;
        const room = rooms[roomCode];
        if (!room || room.phase !== 'vote') return;

        const player = room.players.find(p => p.id === socket.id);
        const target = room.players.find(p => p.id === targetId);
        if (!player || !player.alive || !target || !target.alive) return;
        if (room.votes[socket.id]) return;

        room.votes[socket.id] = targetId;
        const alivePlayers = room.players.filter(p => p.alive);
        
        if (Object.keys(room.votes).length >= alivePlayers.length) {
            clearTimer(roomCode);
            resolveVote(roomCode);
        } else {
            socket.emit('actionConfirmed', 'Vote diterima.');
            broadcastRoom(roomCode);
        }
    });

    socket.on('chatMessage', (msg) => {
        const roomCode = socket.roomCode;
        const room = rooms[roomCode];
        if (!room || !msg || msg.trim() === '') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const chatEntry = { sender: player.name, text: msg.trim(), time: Date.now(), channel: 'public' };
        if (room.phase === 'night' && player.alive) {
            if (player.role === 'Werewolf') chatEntry.channel = 'wolf';
            else if (player.role === 'Penyihir' || player.role === 'Peramal') chatEntry.channel = 'special';
            else return;
        }
        if (!player.alive) chatEntry.channel = 'dead';

        if (chatEntry.channel === 'wolf') room.players.filter(p => p.role === 'Werewolf').forEach(p => io.to(p.id).emit('chatMessage', chatEntry));
        else if (chatEntry.channel === 'special') room.players.filter(p => p.role === 'Penyihir' || p.role === 'Peramal').forEach(p => io.to(p.id).emit('chatMessage', chatEntry));
        else if (chatEntry.channel === 'dead') room.players.filter(p => !p.alive).forEach(p => io.to(p.id).emit('chatMessage', chatEntry));
        else io.to(roomCode).emit('chatMessage', chatEntry);
    });

    socket.on('playAgain', () => {
        const roomCode = socket.roomCode;
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        clearTimer(roomCode);
        room.phase = 'lobby'; room.nightCount = 0; room.votes = {};
        room.wolfTarget = null; room.witchTarget = null; room.witchAction = null;
        
        // Hapus bot jika sebelumnya mode bot
        if (room.isBotMode) {
            room.players = room.players.filter(p => !p.isBot);
        }

        room.players.forEach(p => { p.alive = true; p.role = 'Warga'; p.witchUsed = false; });
        broadcastRoom(roomCode);
    });

    socket.on('disconnect', () => {
        const roomCode = socket.roomCode;
        if (!roomCode || !rooms[roomCode]) return;
        const room = rooms[roomCode];
        room.players = room.players.filter(p => p.id !== socket.id);

        if (room.players.length === 0) { clearTimer(roomCode); delete rooms[roomCode]; return; }
        if (room.hostId === socket.id) room.hostId = room.players[0].id;
        broadcastRoom(roomCode);
    });
});

// ================= GAME LOGIC =================

function resolveNight(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'night') return;
    clearTimer(roomCode);

    let deaths = [];
    let saved = false;

    if (room.witchTarget && room.witchAction) {
        const witch = room.players.find(p => p.role === 'Penyihir');
        if (witch) witch.witchUsed = true;

        if (room.witchAction === 'heal') {
            if (room.wolfTarget === room.witchTarget) saved = true;
        } 
        else if (room.witchAction === 'poison') {
            const poisoned = room.players.find(p => p.id === room.witchTarget);
            if (poisoned && poisoned.alive) { poisoned.alive = false; deaths.push(poisoned.name); }
        }
    }

    if (room.wolfTarget && !saved) {
        const victim = room.players.find(p => p.id === room.wolfTarget);
        if (victim && victim.alive) { 
            victim.alive = false; 
            if(!deaths.includes(victim.name)) deaths.push(victim.name); 
        }
    }

    room.phase = 'day';
    room.wolfTarget = null; room.witchTarget = null; room.witchAction = null;
    room.votes = {};

    io.to(roomCode).emit('nightResult', { deaths, saved });
    if (checkWin(roomCode)) return;

    startPhaseTimer(roomCode, 'day');
    broadcastRoom(roomCode);

    // Jika mode bot, picu aksi bot untuk siang/vote nanti
    if (room.isBotMode) processBotActions(roomCode);
}

function resolveVote(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'vote') return;
    clearTimer(roomCode);

    const voteCounts = {};
    for (const voterId in room.votes) {
        voteCounts[room.votes[voterId]] = (voteCounts[room.votes[voterId]] || 0) + 1;
    }

    let maxVotes = 0, lynchedId = null, tie = false;
    for (const id in voteCounts) {
        if (voteCounts[id] > maxVotes) { maxVotes = voteCounts[id]; lynchedId = id; tie = false; }
        else if (voteCounts[id] === maxVotes) tie = true;
    }

    let lynchedName = null;
    if (lynchedId && !tie) {
        const victim = room.players.find(p => p.id === lynchedId);
        if (victim && victim.alive) { victim.alive = false; lynchedName = victim.name; }
    }

    room.phase = 'night';
    room.nightCount += 1;
    room.votes = {};

    io.to(roomCode).emit('voteResult', { lynchedName, tie });
    if (checkWin(roomCode)) return;

    startPhaseTimer(roomCode, 'night');
    broadcastRoom(roomCode);

    // Jika mode bot, picu aksi bot untuk malam berikutnya
    if (room.isBotMode) processBotActions(roomCode);
}

function checkWin(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.phase === 'end') return false;

    const wolves = room.players.filter(p => p.alive && p.role === 'Werewolf').length;
    const nonWolves = room.players.filter(p => p.alive && p.role !== 'Werewolf').length;

    let winner = null;
    if (wolves === 0) winner = 'Warga';
    else if (wolves >= nonWolves) winner = 'Werewolf';

    if (winner) {
        room.phase = 'end';
        clearTimer(roomCode);
        broadcastRoom(roomCode);
        io.to(roomCode).emit('gameOver', { winner, room });
        return true;
    }
    return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server berjalan di port ${PORT}`));