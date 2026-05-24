const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

// Храним список ID тех пользователей, кто НАЖАЛ кнопку и готов к звонку
let activeParticipants = [];

io.on('connection', (socket) => {
  console.log('Пользователь зашел на сайт:', socket.id);

  // Когда пользователь нажал кнопку "Подключиться к связи"
  socket.on('join-call', () => {
    if (!activeParticipants.includes(socket.id)) {
      activeParticipants.push(socket.id);
      console.log('Пользователь готов к звонку:', socket.id);
    }

    // Если готовых к звонку участников стало двое — запускаем созвон
    if (activeParticipants.length === 2) {
      // Отправляем сигнал первому готовому пользователю, чтобы он начал звонок
      io.to(activeParticipants[0]).emit('start-call');
    }
  });

  socket.on('signal', (data) => {
    socket.broadcast.emit('signal', data);
  });

  socket.on('disconnect', () => {
    console.log('Пользователь ушел:', socket.id);
    activeParticipants = activeParticipants.filter(id => id !== socket.id);
  });
});

const PORT = 3000;
http.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен. Локальный адрес: http://localhost:${PORT}`);
});