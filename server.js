// =================================================================
// --- SERVER TRUNG TÂM: HÀNH TINH MƠ ƯỚC (ULTIMATE MASTER 2026) ---
// =================================================================
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require("socket.io");
const session = require('express-session');
const bcrypt = require('bcrypt');

// --- 1. IMPORT DỮ LIỆU & LOGIC ---
const { tests, maths } = require('./question-data.js');
const MonopolyGame = require('./monopoly-logic.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// --- 2. CẤU HÌNH MIDDLEWARE ---
const sessionMiddleware = session({
    secret: 'hanh-tinh-mo-uoc-vinh-cuu-merged-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } 
});
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);
app.use(express.json());
app.use(express.static(__dirname));

// --- 3. CƠ SỞ DỮ LIỆU & TRẠNG THÁI ---
const users = {};
const saltRounds = 10;
let maintenanceMode = false;

const waitingPlayers = { chess: null, caro: null };
const mathWaitingPlayers = {};
const gameRooms = {};       
const monopolyGames = {};   
const monopolyQueue = []; 

// --- 4. HỆ THỐNG NHIỆM VỤ & ADMIN ---
async function initAdmin() {
    try {
        if (!users['Admin']) {
            const adminPass = await bcrypt.hash("Quoc2007@", saltRounds);
            users['Admin'] = { 
                username: 'Admin', password: adminPass, role: 'admin',
                progress: { 
                    chessLevel: 100, caroLevel: 100, shapeLevel: 50, buildLevel: 100,
                    detectiveLevel: 100, memoryLevel: 60, score: 999999 
                },
                history: [], quests: []
            };
            console.log("✅ [SYSTEM] Master Admin Ready!");
        }
    } catch (e) { console.error(e); }
}
initAdmin();

function generateDailyQuests() {
    return [
        { id: 'q1', description: 'Thắng 1 trận Cờ Vua', target_count: 1, progress: 0, reward_points: 100, expires_at: Date.now() + 86400000 },
        { id: 'q2', description: 'Hoàn thành 2 Bài Kiểm Tra', target_count: 2, progress: 0, reward_points: 150, expires_at: Date.now() + 86400000 },
        { id: 'q3', description: 'Tìm ra điểm khác biệt (Thám tử)', target_count: 1, progress: 0, reward_points: 80, expires_at: Date.now() + 86400000 }
    ];
}

function updateQuestProgress(username, keyword) {
    const user = users[username];
    if (!user || !user.quests) return;
    const quest = user.quests.find(q => q.description.toLowerCase().includes(keyword.toLowerCase()));
    if (quest && quest.progress < quest.target_count) {
        quest.progress++;
        if (quest.progress === quest.target_count) {
            user.progress.score += quest.reward_points;
            user.history.unshift({ activity: `Xong nhiệm vụ: ${quest.description}`, timestamp: Date.now() });
        }
    }
}

// --- 5. API ROUTES: XÁC THỰC, TIẾN ĐỘ & BẢNG XẾP HẠNG ---

app.post('/api/register/parent', async (req, res) => {
    const { username, password } = req.body;
    if (users[username]) return res.status(400).json({ message: 'Tên đã tồn tại.' });
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const parentCode = `PH${Date.now().toString().slice(-6)}`;
    users[username] = { username, password: hashedPassword, role: 'parent', parentCode, children: [] };
    res.json({ message: `Đăng ký thành công! Mã: <strong>${parentCode}</strong>` });
});

app.post('/api/register/child', async (req, res) => {
    const { username, password, parentCode } = req.body;
    const parent = Object.values(users).find(u => u.role === 'parent' && u.parentCode === parentCode);
    if (!parent) return res.status(400).json({ message: 'Mã phụ huynh sai.' });
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    users[username] = { 
        username, password: hashedPassword, role: 'child', parent: parent.username, history: [],
        progress: { chessLevel: 1, caroLevel: 1, shapeLevel: 1, buildLevel: 1, detectiveLevel: 1, score: 0 },
        quests: generateDailyQuests()
    };
    parent.children.push(username);
    res.json({ message: 'Tạo tài khoản thành công!' });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (maintenanceMode && username !== 'Admin') return res.status(503).json({ message: 'Bảo trì.' });
    const user = users[username];
    if (!user || !await bcrypt.compare(password, user.password)) return res.status(401).json({ message: 'Sai thông tin.' });
    req.session.user = { username: user.username, role: user.role };
    res.json({ message: 'Chào mừng trở lại!', user: { username: user.username, role: user.role } });
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        const user = users[req.session.user.username];
        res.json({ username: user.username, role: user.role, score: user.progress?.score || 0 });
    } else res.status(401).end();
});

app.get('/api/user/progress', (req, res) => {
    if (!req.session.user) return res.status(401).end();
    res.json(users[req.session.user.username].progress);
});

app.get('/api/leaderboard', (req, res) => {
    const lb = Object.values(users).filter(u => u.role === 'child')
        .map(u => ({ username: u.username, score: u.progress.score, chessLevel: u.progress.chessLevel }))
        .sort((a,b) => b.score - a.score).slice(0, 10);
    res.json(lb);
});

app.get('/api/quests/my-quests', (req, res) => {
    if (!req.session.user) return res.status(401).end();
    res.json({ quests: users[req.session.user.username].quests || [] });
});

// --- 6. API ROUTES: WIN LOGIC ---
app.post('/api/game/chess-win-level', (req, res) => {
    const user = users[req.session.user?.username];
    const { playedLevel } = req.body;
    if (!user) return res.status(401).end();
    if (parseInt(playedLevel) === user.progress.chessLevel && user.progress.chessLevel < 100) {
        user.progress.chessLevel++;
        user.progress.score += 50;
        updateQuestProgress(user.username, 'Cờ Vua');
    }
    res.json({ success: true, newLevel: user.progress.chessLevel });
});

app.post('/api/game/detective-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    if (user.progress.detectiveLevel < 100) user.progress.detectiveLevel++;
    user.progress.score += 25;
    updateQuestProgress(user.username, 'Thám tử');
    res.json({ newLevel: user.progress.detectiveLevel });
});
// =================================================================
// --- [MỚI] API HỆ THỐNG KIỂM TRA & CHẤM ĐIỂM ---
// =================================================================

// 1. API Lấy Đề Thi
app.get('/api/test', (req, res) => {
    const { subject, grade, difficulty } = req.query;
    
    // Tạo key đúng định dạng trong question-data.js (vd: 'grade1')
    const gradeKey = 'grade' + grade; 

    try {
        // Tìm ngân hàng câu hỏi
        const questionBank = tests[subject]?.[gradeKey]?.[difficulty];
        
        if (!questionBank || questionBank.length === 0) {
            return res.status(404).json({ message: "Chưa có bộ đề cho lựa chọn này." });
        }

        // Lấy ngẫu nhiên 10 câu (hoặc ít hơn nếu không đủ)
        // Trộn đề để mỗi lần thi thứ tự khác nhau
        const shuffled = [...questionBank].sort(() => 0.5 - Math.random());
        const selectedQuestions = shuffled.slice(0, 10);

        res.json(selectedQuestions);
    } catch (e) {
        res.status(500).json({ message: "Lỗi lấy đề thi." });
    }
});

// 2. API Nộp Bài & Chấm Điểm
app.post('/api/submit-test', (req, res) => {
    const user = users[req.session.user?.username];
    const { answers } = req.body; // { 't1_1': '8', 't1_2': '5' ... }

    if (!user) return res.status(401).json({ message: "Bạn cần đăng nhập để nộp bài." });

    let score = 0;
    let total = 0;

    // Duyệt qua tất cả môn và lớp để tìm câu hỏi gốc (Cách này hơi chậm nhưng an toàn)
    // Hoặc nếu client gửi kèm subject/grade thì nhanh hơn. 
    // Ở đây ta duyệt tất cả để tìm ID câu hỏi khớp.
    Object.values(tests).forEach(subject => {
        Object.values(subject).forEach(grade => {
            Object.values(grade).forEach(diff => {
                diff.forEach(q => {
                    // Nếu người dùng có trả lời câu này
                    if (answers[q.id]) {
                        total++;
                        // So sánh đáp án
                        if (answers[q.id] === q.correct) {
                            score++;
                        }
                    }
                });
            });
        });
    });

    // Nếu total = 0 nghĩa là không tìm thấy câu hỏi nào khớp (hack hoặc lỗi),
    // ta lấy số lượng câu trả lời gửi lên làm mẫu số.
    if (total === 0) total = Object.keys(answers).length;

    // Cộng điểm vào tài khoản
    const pointsEarned = score * 10; // Mỗi câu đúng 10 điểm
    user.progress.score += pointsEarned;
    
    // Lưu lịch sử
    user.history.unshift({ 
        activity: `Làm bài kiểm tra: ${score}/${total} câu đúng`, 
        timestamp: Date.now() 
    });

    // Cập nhật nhiệm vụ (Nếu có nhiệm vụ 'Kiểm Tra')
    updateQuestProgress(user.username, 'Kiểm Tra');

    res.json({ 
        score: score, 
        total: total, 
        message: `Bạn làm đúng ${score}/${total} câu. Nhận được +${pointsEarned} điểm!` 
    });
});
// --- API MỚI CHO: Ô CHỮ (100 Cấp) ---
app.post('/api/game/crossword-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    const { level } = req.body;
    
    // Khởi tạo nếu chưa có
    if (!user.progress.crosswordLevel) user.progress.crosswordLevel = 1;

    // Chỉ tăng cấp nếu thắng cấp độ hiện tại
    if (user.progress.crosswordLevel === parseInt(level) && user.progress.crosswordLevel < 100) {
        user.progress.crosswordLevel++;
        user.progress.score += 20; // Thưởng 20 điểm
        updateQuestProgress(user.username, 'Ô Chữ');
        res.json({ success: true, newLevel: user.progress.crosswordLevel, message: "Tuyệt vời! Đã mở khóa cấp mới." });
    } else {
        res.json({ success: true, message: "Đã hoàn thành (Chơi lại không cộng cấp)." });
    }
});

// --- API MỚI CHO: LUYỆN NÓI TIẾNG ANH (100 Cấp) ---
app.post('/api/game/english-speech-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    const { level, score } = req.body;

    if (!user.progress.englishSpeechLevel) user.progress.englishSpeechLevel = 1;

    if (user.progress.englishSpeechLevel === parseInt(level) && user.progress.englishSpeechLevel < 100) {
        user.progress.englishSpeechLevel++;
        user.progress.score += 15;
        res.json({ success: true, newLevel: user.progress.englishSpeechLevel, message: "Good job! Next level unlocked." });
    } else {
        res.json({ success: true, message: "Practice makes perfect!" });
    }
});
// ... (Các code cũ giữ nguyên)

// --- API MỚI: SÁNG TÁC TRUYỆN (100 Cấp) ---
app.post('/api/game/story-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    
    const { level, score } = req.body;

    // Khởi tạo nếu chưa có
    if (!user.progress.storyLevel) user.progress.storyLevel = 1;

    // Chỉ tăng cấp nếu hoàn thành cấp hiện tại và điểm số đạt yêu cầu (>50 điểm)
    if (user.progress.storyLevel === parseInt(level) && user.progress.storyLevel < 100 && score >= 50) {
        user.progress.storyLevel++;
        user.progress.score += Math.floor(score / 2); // Cộng điểm thưởng dựa trên điểm chấm
        updateQuestProgress(user.username, 'Sáng Tác');
        res.json({ success: true, newLevel: user.progress.storyLevel, message: "Tuyệt vời! Truyện rất hay." });
    } else {
        res.json({ success: true, message: "Đã lưu truyện vào nhật ký!" });
    }
});
// --- API MỚI: CỜ VÂY (60 Cấp) ---
app.post('/api/game/go-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    
    const { level } = req.body;

    // Khởi tạo nếu chưa có cấp độ Cờ Vây
    if (!user.progress.goLevel) user.progress.goLevel = 1;

    // Tăng cấp nếu thắng cấp hiện tại (tương tự Cờ Vua/Caro)
    if (user.progress.goLevel === parseInt(level) && user.progress.goLevel < 60) {
        user.progress.goLevel++;
        user.progress.score += 50; 
        updateQuestProgress(user.username, 'Cờ Vây');
        res.json({ success: true, newLevel: user.progress.goLevel, message: "Tuyệt vời! Bạn đã thăng cấp Cờ Vây." });
    } else {
        user.progress.score += 10; // Thắng lại cấp cũ chỉ tặng ít điểm
        res.json({ success: true, message: "Bạn đã thắng! +10 điểm tích lũy." });
    }
});
// Thêm vào cùng chỗ với chess-win-level trong server.js
app.post('/api/game/othello-win', (req, res) => {
    const user = users[req.session.user?.username];
    if (!user) return res.status(401).end();
    
    // Nếu chưa có trường othelloLevel thì tạo mới
    if(!user.progress.othelloLevel) user.progress.othelloLevel = 1;
    
    if (user.progress.othelloLevel < 100) {
        user.progress.othelloLevel++;
        user.progress.score += 30; // Thưởng 30 điểm
    }
    res.json({ success: true, newLevel: user.progress.othelloLevel });
});
// =================================================================
// --- [HỆ THỐNG QUẢN TRỊ ADMIN] ---
// =================================================================

// 1. Kiểm tra quyền Admin
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') next();
    else res.status(403).json({ message: "Từ chối truy cập!" });
};

// 2. Lấy danh sách tất cả người dùng
app.get('/api/admin/all-users', isAdmin, (req, res) => {
    const list = Object.values(users).map(u => ({
        username: u.username,
        role: u.role,
        score: u.progress?.score || 0,
        chessLevel: u.progress?.chessLevel || 1,
        caroLevel: u.progress?.caroLevel || 1,
        memoryLevel: u.progress?.memoryLevel || 1,
        crosswordLevel: u.progress?.crosswordLevel || 1,
        speechLevel: u.progress?.speechLevel || 1,
        isSuspended: u.isSuspended || 0
    }));
    res.json(list);
});

// 3. Cập nhật dữ liệu người dùng (Sửa lỗi "không chỉnh được")
app.post('/api/admin/update-user', isAdmin, (req, res) => {
    const { username, score, chessLevel, caroLevel, memoryLevel, crosswordLevel, speechLevel } = req.body;
    const user = users[username];
    if (user) {
        user.progress.score = parseInt(score);
        user.progress.chessLevel = parseInt(chessLevel);
        user.progress.caroLevel = parseInt(caroLevel);
        user.progress.memoryLevel = parseInt(memoryLevel);
        user.progress.crosswordLevel = parseInt(crosswordLevel);
        user.progress.speechLevel = parseInt(speechLevel);
        res.json({ message: `Đã cập nhật dữ liệu cho ${username}` });
    } else res.status(404).json({ message: "Không tìm thấy người dùng" });
});

// 4. [MỚI] Giao nhiệm vụ riêng cho từng người
app.post('/api/admin/assign-quest', isAdmin, (req, res) => {
    const { username, description, target, reward } = req.body;
    const user = users[username];
    if (user) {
        if (!user.quests) user.quests = [];
        const newQuest = {
            id: 'custom_' + Date.now(),
            description: description,
            target_count: parseInt(target),
            progress: 0,
            reward_points: parseInt(reward),
            expires_at: Date.now() + 86400000 * 7 // Hết hạn sau 7 ngày
        };
        user.quests.push(newQuest);
        res.json({ message: `Đã giao nhiệm vụ cho ${username}!` });
    } else res.status(404).json({ message: "Lỗi người dùng" });
});

// 5. Các API phụ trợ (Khóa, Reset PW...)
app.post('/api/admin/toggle-suspend', isAdmin, (req, res) => {
    const user = users[req.body.username];
    if (user && user.username !== 'Admin') {
        user.isSuspended = user.isSuspended ? 0 : 1;
        res.json({ message: user.isSuspended ? "Đã khóa" : "Đã mở khóa" });
    }
});

app.post('/api/admin/reset-password', isAdmin, async (req, res) => {
    const user = users[req.body.username];
    if (user) {
        user.password = await bcrypt.hash("123456", 10);
        res.json({ message: "Mật khẩu đã về 123456" });
    }
});
// --- 7. SOCKET.IO: MULTIPLAYER GAMES ---
io.on('connection', (socket) => {
    const username = socket.request.session.user?.username || `Khách_${socket.id.slice(0,4)}`;

    // --- MONOPOLY ---
    socket.on('findMonopolyMatch', () => {
        if (!monopolyQueue.includes(socket.id)) monopolyQueue.push(socket.id);
        if (monopolyQueue.length >= 2) {
            const p1 = monopolyQueue.shift(); const p2 = monopolyQueue.shift();
            const roomId = `AUTO_${Date.now()}`;
            const game = new MonopolyGame(roomId);
            monopolyGames[roomId] = game;
            [p1, p2].forEach(sid => {
                const s = io.sockets.sockets.get(sid);
                if (s) { s.join(roomId); game.addPlayer(sid, s.request.session.user?.username || "Bạn"); }
            });
            io.to(roomId).emit('monopolyUpdate', { players: game.players, roomId });
        }
    });

    socket.on('createMonopolyRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        monopolyGames[roomId] = new MonopolyGame(roomId);
        socket.join(roomId);
        monopolyGames[roomId].addPlayer(socket.id, username);
        socket.emit('roomCreated', roomId);
        socket.emit('monopolyUpdate', { players: monopolyGames[roomId].players, roomId });
    });

    socket.on('joinMonopolyRoom', (roomId) => {
        const game = monopolyGames[roomId];
        if (game && game.players.length < 4) {
            socket.join(roomId); game.addPlayer(socket.id, username);
            io.to(roomId).emit('monopolyUpdate', { players: game.players, roomId });
        }
    });

    // --- CHESS GROUPS ---
    socket.on('createChessRoom', () => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(roomId); socket.emit('roomCreated', roomId);
    });

    socket.on('joinChessRoom', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        if (room && room.size === 1) {
            socket.join(roomId);
            io.to(roomId).emit('matchFound', { room: roomId, role: 'b' });
        }
    });

    // --- GLOBAL MATCHMAKING ---
    socket.on('findMatch', (gameType) => {
        if (waitingPlayers[gameType]) {
            const opp = waitingPlayers[gameType]; waitingPlayers[gameType] = null;
            const room = `${gameType}_${Date.now()}`;
            socket.join(room); opp.join(room);
            io.to(socket.id).emit('matchFound', { room, role: 'w' });
            io.to(opp.id).emit('matchFound', { room, role: 'b' });
        } else waitingPlayers[gameType] = socket;
    });

    socket.on('move', (data) => socket.to(data.room).emit('opponentMove', data.move));
    // --- GO (CỜ VÂY) ---
    socket.on('createGoRoom', ({ size }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        // Lưu loại game vào gameRooms để xử lý khi ngắt kết nối
        gameRooms[roomId] = { type: 'go', size: parseInt(size) };
        socket.join(roomId);
        socket.emit('goRoomCreated', roomId);
    });

    socket.on('joinGoRoom', (roomId) => {
        const room = io.sockets.adapter.rooms.get(roomId);
        const roomData = gameRooms[roomId];
        if (room && room.size === 1 && roomData && roomData.type === 'go') {
            socket.join(roomId);
            // Gửi thông báo bắt đầu trận đấu cho cả 2 người
            io.to(roomId).emit('matchFound', { room: roomId, role: 'w', size: roomData.size });
        } else {
            socket.emit('errorMsg', 'Phòng không tồn tại hoặc đã đầy!');
        }
    });

    socket.on('goMove', (data) => {
        socket.to(data.room).emit('opponentGoMove', data.move);
    });

    socket.on('goPass', (data) => {
        socket.to(data.room).emit('opponentPassed');
    });
    // =============================================================
    // --- CARO SUPER MULTIPLAYER (2-8 PLAYERS) ---
    // =============================================================
    
    // 1. Tạo phòng Caro tùy chỉnh
    socket.on('createCaroRoom', ({ maxPlayers, boardSize }) => {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Khởi tạo dữ liệu phòng
        gameRooms[roomId] = {
            id: roomId,
            gameType: 'caro',
            maxPlayers: parseInt(maxPlayers),
            boardSize: parseInt(boardSize),
            players: [], // Danh sách socket.id
            playerNames: {}, // Map id -> tên
            turnIndex: 0, // Lượt của người thứ mấy
            isPlaying: false
        };

        socket.join(roomId);
        const room = gameRooms[roomId];
        room.players.push(socket.id);
        room.playerNames[socket.id] = username; // Biến username đã có sẵn ở đầu hàm connection

        // Gửi lại thông tin phòng cho chủ phòng
        socket.emit('caroRoomCreated', { roomId, maxPlayers });
        
        // Cập nhật trạng thái sảnh chờ (Lobby)
        io.to(roomId).emit('updateLobby', {
            players: room.players.map(id => room.playerNames[id]),
            maxPlayers: room.maxPlayers,
            roomId: roomId
        });
    });

    // 2. Vào phòng Caro
    socket.on('joinCaroRoom', (roomId) => {
        const room = gameRooms[roomId];
        
        if (!room || room.gameType !== 'caro') {
            return socket.emit('errorMsg', 'Phòng không tồn tại!');
        }
        if (room.isPlaying) {
            return socket.emit('errorMsg', 'Game đang diễn ra!');
        }
        if (room.players.length >= room.maxPlayers) {
            return socket.emit('errorMsg', 'Phòng đã đầy!');
        }

        socket.join(roomId);
        room.players.push(socket.id);
        room.playerNames[socket.id] = username;

        // Cập nhật sảnh chờ cho tất cả mọi người trong phòng
        io.to(roomId).emit('updateLobby', {
            players: room.players.map(id => room.playerNames[id]),
            maxPlayers: room.maxPlayers,
            roomId: roomId
        });

        // Nếu đã đủ người -> BẮT ĐẦU GAME
        if (room.players.length === room.maxPlayers) {
            room.isPlaying = true;
            room.turnIndex = 0; // Người tạo phòng đi trước
            io.to(roomId).emit('caroGameStart', {
                players: room.players, // Gửi danh sách ID để client biết thứ tự
                names: room.playerNames,
                boardSize: room.boardSize,
                currentTurn: room.players[0]
            });
        }
    });

    // 3. Xử lý nước đi Caro
    socket.on('caroMoveCustom', ({ roomId, r, c }) => {
        const room = gameRooms[roomId];
        if (!room || !room.isPlaying) return;

        // Kiểm tra đúng lượt không
        const currentPlayerId = room.players[room.turnIndex];
        if (socket.id !== currentPlayerId) return;

        // Tính lượt tiếp theo
        let nextIndex = (room.turnIndex + 1) % room.players.length;
        room.turnIndex = nextIndex;
        const nextPlayerId = room.players[nextIndex];

        // Gửi nước đi cho cả phòng
        io.to(roomId).emit('caroMoveUpdate', {
            r, c,
            playerId: socket.id, // Ai vừa đi
            nextTurn: nextPlayerId // Đến lượt ai
        });
    });

    // 4. Xử lý thắng thua (Client báo lên)
    socket.on('caroWinCustom', ({ roomId }) => {
        const room = gameRooms[roomId];
        if (room) {
            io.to(roomId).emit('caroGameOver', {
                winnerId: socket.id,
                winnerName: room.playerNames[socket.id]
            });
            delete gameRooms[roomId]; // Xóa phòng sau khi xong
        }
    });
   // --- XỬ LÝ NGẮT KẾT NỐI (GỘP CHUNG TẤT CẢ GAME) ---
    socket.on('disconnecting', () => {
        // 1. Xóa khỏi hàng chờ Monopoly (nếu đang chờ)
        const idx = monopolyQueue.indexOf(socket.id);
        if (idx > -1) monopolyQueue.splice(idx, 1);

        // 2. Xử lý các phòng game mà user đang tham gia
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                const room = gameRooms[roomId];

                // Nếu là phòng Caro Custom (Code mới)
                if (room && room.gameType === 'caro') {
                    io.to(roomId).emit('playerLeft', { name: room.playerNames[socket.id] });
                    delete gameRooms[roomId]; // Hủy phòng nếu có người thoát
                } 
                // Nếu là phòng 1vs1 thường (Cờ vua, Caro cũ, Toán)
                else {
                    socket.to(roomId).emit('opponentLeft'); 
                    // Xóa dữ liệu phòng nếu có (ví dụ phòng Toán)
                    if (gameRooms[roomId]) delete gameRooms[roomId];
                }
            }
        }
    });

}); // <--- Đây là dấu đóng ngoặc của io.on('connection')
server.listen(PORT, () => { console.log(`🚀 MASTER SERVER ULTIMATE 2026 TẠI CỔNG ${PORT}`); });