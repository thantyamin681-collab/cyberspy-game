const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// 🗂️ Rooms Database (အခန်းများအားလုံး၏ အချက်အလက် သိုလှောင်မှု)
let rooms = {}; 

const topicPairs = [
    { citizen: "Eating Durian (ဒူးရင်းသီးစားခြင်း)", undercover: "Eating Jackfruit (ပိန္နဲသီးစားခြင်း)" },
    { citizen: "Sleeping in Class (အတန်းထဲတွင် အိပ်ငိုက်ခြင်း)", undercover: "Sleeping at Work (ရုံးထဲတွင် အိပ်ငိုက်ခြင်း)" },
    { citizen: "TikTok Dancing (တစ်တော့ခ် ကခြင်း)", undercover: "YouTube Shorts Dancing (ယူကျုရှော့စ် ကခြင်း)" },
    { citizen: "Watching Ghost Movies (သရဲကားကြည့်ခြင်း)", undercover: "Watching Zombie Movies (ဇွန်ဘီကားကြည့်ခြင်း)" },
    { citizen: "Using ChatGPT/AI (အိုင်အေသုံးခြင်း)", undercover: "Using Google Search (ဂူဂဲလ်ရှာဖွေခြင်း)" },
    { citizen: "Drinking Bubble Tea (ပုလဲနို့လက်ဖက်ရည်သောက်ခြင်း)", undercover: "Drinking Iced Coffee (အအေးဆိုင်တွင် ကော်ဖီသောက်ခြင်း)" },
    { citizen: "Playing Mobile Legends (မိုဘိုင်းလန်းဆော့ခြင်း)", undercover: "Playing PUBG Mobile (ပတ်ဘ်ဂျီဆော့ခြင်း)" },
    { citizen: "Going to the Gym (ဂျင်ဆော့ခြင်း)", undercover: "Running in the Park (ပန်းခြံထဲ လမ်းလျှောက်ခြင်း)" },
    { citizen: "Buying expensive shoes (ဈေးကြီးတဲ့ဖိနပ်ဝယ်ခြင်း)", undercover: "Buying luxury watch (ဈေးကြီးတဲ့လက်ပတ်နာရီဝယ်ခြင်း)" },
    { citizen: "Stalking an Ex (ရည်းစားဟောင်းအကောင့် ချောင်းခြင်း)", undercover: "Stalking a Crush (Crush အကောင့်ကို လိုက်ချောင်းခြင်း)" }
];

io.on('connection', (socket) => {
    let currentRoomCode = null;
    let currentUsername = null;

    // 🔑 အခန်းသစ်တည်ဆောက်ခြင်း (Create Room)
    socket.on('createRoom', ({ username, avatar }) => {
        const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase(); // e.g., "X7B9"
        rooms[roomCode] = {
            code: roomCode,
            users: [],
            votes: {},
            totalVotesReceived: 0,
            isGameActive: false,
            leaderboards: {},
            currentRoundTopicPair: null,
            currentActualSpy: null
        };
        
        joinRoomLogic(socket, roomCode, username, avatar);
    });

    // 🚪 အခန်းထဲသို့ ကုဒ်ဖြင့်ဝင်ရောက်ခြင်း (Join Room)
    socket.on('joinRoom', ({ roomCode, username, avatar }) => {
        const targetCode = roomCode.trim().toUpperCase();
        if (!rooms[targetCode]) {
            socket.emit('roomError', 'Invalid Room Code! အခန်းကုဒ် မှားယွင်းနေပါသည်။');
            return;
        }
        if (rooms[targetCode].isGameActive || rooms[targetCode].users.length >= 5) {
            socket.emit('roomError', 'Room Full or Match Active! အခန်းပြည့်နေပါသည် သို့မဟုတ် ပွဲစနေပါသည်။');
            return;
        }
        
        joinRoomLogic(socket, targetCode, username, avatar);
    });

    function joinRoomLogic(socket, roomCode, username, avatar) {
        currentRoomCode = roomCode;
        currentUsername = username;

        socket.join(roomCode);
        const room = rooms[roomCode];

        if (!room.leaderboards[username]) room.leaderboards[username] = 0;

        room.users.push({ id: socket.id, name: username, avatar: avatar, role: 'Citizen' });
        
        socket.emit('roomJoined', { roomCode: roomCode, username: username });
        io.to(roomCode).emit('updateUsers', { users: room.users, scoreboard: room.leaderboards });

        if (room.users.length === 5) {
            startGame(roomCode);
        }
    }

    socket.on('triggerForceStart', () => {
        const room = rooms[currentRoomCode];
        if (room && room.users.length >= 3 && room.users.length <= 5) {
            startGame(currentRoomCode);
        }
    });

    socket.on('sendMessage', (messageData) => {
        if (currentRoomCode) {
            io.to(currentRoomCode).emit('receiveMessage', messageData);
        }
    });

    socket.on('castVote', (targetName) => {
        const room = rooms[currentRoomCode];
        if (!room) return;

        room.votes[targetName] = (room.votes[targetName] || 0) + 1;
        room.totalVotesReceived++;

        if (room.totalVotesReceived === room.users.length) {
            evaluateVotingResults(currentRoomCode);
        }
    });

    socket.on('spySubmitGuess', (guessedWord) => {
        const room = rooms[currentRoomCode];
        if (!room) return;

        const cleanGuess = guessedWord.trim().toLowerCase();
        const cleanAnswer = room.currentRoundTopicPair.citizen.split(' (')[0].toLowerCase();

        let spyWon = false;
        if (cleanAnswer.includes(cleanGuess) || cleanGuess.includes(cleanAnswer)) {
            spyWon = true;
        }

        awardPointsAndFinish(currentRoomCode, spyWon, "Spy Guess Decision");
    });

    socket.on('requestPlayAgain', () => {
        const room = rooms[currentRoomCode];
        if (room && !room.isGameActive && room.users.length >= 3) {
            startGame(currentRoomCode);
        }
    });

    socket.on('disconnect', () => {
        if (currentRoomCode && rooms[currentRoomCode]) {
            const room = rooms[currentRoomCode];
            room.users = room.users.filter(user => user.id !== socket.id);
            io.to(currentRoomCode).emit('updateUsers', { users: room.users, scoreboard: room.leaderboards });
            
            if (room.users.length < 3) {
                room.isGameActive = false;
                io.to(currentRoomCode).emit('gameReset');
            }
            if (room.users.length === 0) {
                delete rooms[currentRoomCode]; // Delete empty room from memory
            }
        }
    });
});

function startGame(roomCode) {
    const room = rooms[roomCode];
    room.isGameActive = true;
    room.votes = {};
    room.totalVotesReceived = 0;

    const indices = Array.from({length: room.users.length}, (_, i) => i);
    const spyIdx = indices.splice(Math.floor(Math.random() * indices.length), 1)[0];
    
    let undercoverIdx = -1;
    if (room.users.length >= 4) {
        undercoverIdx = indices.splice(Math.floor(Math.random() * indices.length), 1)[0];
    }

    room.currentRoundTopicPair = topicPairs[Math.floor(Math.random() * topicPairs.length)];

    room.users.forEach((user, index) => {
        if (index === spyIdx) {
            user.role = 'SPY';
            room.currentActualSpy = user;
        } else if (index === undercoverIdx) {
            user.role = 'Undercover';
        } else {
            user.role = 'Citizen';
        }
    });

    room.users.forEach(user => {
        let personalTopic = "???";
        if (user.role === 'Citizen') personalTopic = room.currentRoundTopicPair.citizen;
        if (user.role === 'Undercover') personalTopic = room.currentRoundTopicPair.undercover;

        io.to(user.id).emit('gameStarted', {
            role: user.role,
            topic: personalTopic,
            allPlayers: room.users.map(u => u.name)
        });
    });
}

function evaluateVotingResults(roomCode) {
    const room = rooms[roomCode];
    let highestVotes = 0;
    let mostVotedPlayer = '';

    for (let player in room.votes) {
        if (room.votes[player] > highestVotes) {
            highestVotes = room.votes[player];
            mostVotedPlayer = player;
        }
    }

    const spyObj = room.users.find(u => u.role === 'SPY');
    
    if (mostVotedPlayer === spyObj.name) {
        io.to(roomCode).emit('spyPromptGuessingPhase', {
            accused: mostVotedPlayer,
            spyName: spyObj.name
        });
    } else {
        awardPointsAndFinish(roomCode, true, mostVotedPlayer);
    }
}

function awardPointsAndFinish(roomCode, spyWon, accused) {
    const room = rooms[roomCode];
    const actualSpy = room.users.find(u => u.role === 'SPY');

    if (spyWon) {
        if(room.leaderboards[actualSpy.name] !== undefined) room.leaderboards[actualSpy.name] += 25;
    } else {
        room.users.forEach(u => {
            if (u.role !== 'SPY' && room.leaderboards[u.name] !== undefined) {
                room.leaderboards[u.name] += 10;
            }
        });
    }

    io.to(roomCode).emit('votingFinished', {
        accused: accused,
        spyName: actualSpy.name,
        spyWon: spyWon,
        secretAnswer: room.currentRoundTopicPair.citizen,
        scoreboard: room.leaderboards
    });

    room.isGameActive = false;
}

http.listen(5000, () => console.log('🚀 Room-Based Advanced Engine running on port 5000'));