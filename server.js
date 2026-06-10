const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Static Files များကို public ဖိုဒါထဲတွင် ရှာရန်
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

// Web Browser တွင် Refresh နှိပ်ပါက Error မတက်စေရန် Catch-All Route ထည့်သွင်းခြင်း
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

    // 🚪 အခန်းထဲမှ ထွက်ခွာခြင်း (Leave Room Logic)
    socket.on('leaveRoom', () => {
        handleUserExit(socket);
    });

    // 🔌 လိုင်းကျသွားခြင်း သို့မဟုတ် Browser ပိတ်လိုက်ခြင်း
    socket.on('disconnect', () => {
        handleUserExit(socket);
    });

    function handleUserExit(socket) {
        if (currentRoomCode && rooms[currentRoomCode]) {
            const room = rooms[currentRoomCode];
            room.users = room.users.filter(user => user.id !== socket.id);
            
            io.to(currentRoomCode).emit('updateUsers', { users: room.users, scoreboard: room.leaderboards });
            
            if (room.users.length < 3 && room.isGameActive) {
                room.isGameActive = false;
                io.to(currentRoomCode).emit('gameResetNotification');
            }
            if (room.users.length === 0) {
                delete rooms[currentRoomCode];
            }
            socket.leave(currentRoomCode);
            currentRoomCode = null;
        }
    }
});

// Cloud Deployment ပေါ်တွင် Dynamic Port အသုံးပြုနိုင်ရန် သတ်မှတ်ခြင်း
const PORT = process.env.PORT || 5000;
http.listen(PORT, () => console.log(`🚀 Advanced Server is running on port ${PORT}`));