const socket = io();

let localStream = null;
let screenStream = null;
let peerConnection = null;
let isMuted = false;
let isNoiseSuppressionOn = true;
let isScreenSharing = false;

// Элементы интерфейса
const btnConnect = document.getElementById('btnConnect');
const btnMute = document.getElementById('btnMute');
const btnNoise = document.getElementById('btnNoise');
const btnScreen = document.getElementById('btnScreen');
const remoteVideo = document.getElementById('remoteVideo');
const videoPlaceholder = document.getElementById('videoPlaceholder');
const statusDiv = document.getElementById('status');

// Настройки серверов обхода NAT (STUN-серверы Google, чтобы связаться через интернет)
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Функция запуска захвата микрофона с настройками шумоподавления
async function getAudioStream(noiseSuppression) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true, // Эхоподавление
        noiseSuppression: noiseSuppression, // Шумоподавление
        autoGainControl: true // Автоусиление звука
      },
      video: false
    });
  } catch (err) {
    console.error('Ошибка доступа к микрофону:', err);
    alert('Не удалось получить доступ к микрофону. Проверьте разрешения в браузере.');
    throw err;
  }
}

// Кнопка: Подключиться к связи
btnConnect.onclick = async () => {
  statusDiv.innerText = 'Запуск микрофона...';
  
  // 1. Получаем звук с микрофона (по умолчанию шумоподавление ВКЛ)
  localStream = await getAudioStream(true);
  
  btnConnect.style.display = 'none';
  btnMute.style.display = 'inline-block';
  btnNoise.style.display = 'inline-block';
  btnScreen.style.display = 'inline-block';
  
  statusDiv.innerText = 'Подключено к серверу. Ожидаем друга...';

  // Сообщаем серверу, что мы готовы к звонку!
  socket.emit('join-call');
};

// Функция создания Peer Connection
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // Добавляем наши локальные аудио-треки в соединение
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Получаем входящий поток от друга
  peerConnection.ontrack = (event) => {
    console.log('Получен удаленный поток');
    remoteVideo.srcObject = event.streams[0];
    videoPlaceholder.style.display = 'none';
  };

  // Отправка ICE-кандидатов (технические адреса для прямой связи)
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { candidate: event.candidate });
    }
  };
}

// Сигнал от сервера: Пора звонить (вызывается, когда оба участника нажали кнопку)
socket.on('start-call', async () => {
  if (!localStream) return;
  statusDiv.innerText = 'Соединение с другом...';
  
  createPeerConnection();

  // Создаем Offer (предложение связи)
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  socket.emit('signal', { offer: offer });
});

// Обработка сигналов WebRTC от друга
socket.on('signal', async (data) => {
  if (!localStream) return;

  if (data.offer) {
    statusDiv.innerText = 'Входящий вызов...';
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', { answer: answer });
    statusDiv.innerText = 'В разговоре';
  } 
  
  else if (data.answer) {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    statusDiv.innerText = 'В разговоре';
  } 
  
  else if (data.candidate) {
    try {
      if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    } catch (e) {
      console.warn('Ошибка добавления ICE кандидата:', e);
    }
  }
});

// Кнопка: Вкл/Выкл Микрофон (Mute)
btnMute.onclick = () => {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  
  if (isMuted) {
    btnMute.innerText = 'Вкл. Микрофон';
    btnMute.className = 'active';
  } else {
    btnMute.innerText = 'Выкл. Микрофон';
    btnMute.className = 'danger';
  }
};

// Кнопка: Вкл/Выкл встроенное шумоподавление
btnNoise.onclick = async () => {
  if (!localStream) return;

  isNoiseSuppressionOn = !isNoiseSuppressionOn;

  // Чтобы переключить шумоподавление, нам нужно перезапросить аудиопоток с новыми параметрами
  const newStream = await getAudioStream(isNoiseSuppressionOn);
  const newTrack = newStream.getAudioTracks()[0];

  // Заменяем трек в отправляемом соединении
  if (peerConnection) {
    const senders = peerConnection.getSenders();
    const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
    if (audioSender) {
      await audioSender.replaceTrack(newTrack);
    }
  }

  // Останавливаем старый трек
  localStream.getAudioTracks().forEach(track => track.stop());
  
  // Сохраняем ссылку на новый поток
  localStream = newStream;

  if (isNoiseSuppressionOn) {
    btnNoise.innerText = 'Шумоподавление: ВКЛ';
    btnNoise.className = 'active';
  } else {
    btnNoise.innerText = 'Шумоподавление: ВЫКЛ';
    btnNoise.className = '';
  }
};

// Кнопка: Демонстрация экрана (Трансляция)
btnScreen.onclick = async () => {
  if (!localStream) {
    alert('Сначала нажмите кнопку "Подключиться к связи"!');
    return;
  }
  if (!peerConnection) {
    alert('Трансляция экрана станет доступна, как только подключится ваш друг (собеседник)!');
    return;
  }

  if (!isScreenSharing) {
    try {
      // Запрашиваем трансляцию экрана
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true // Позволяет также транслировать системный звук
      });

      const videoTrack = screenStream.getVideoTracks()[0];

      // Добавляем видеопоток в наше Peer Connection
      const senders = peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');

      if (videoSender) {
        // Если видео-отправитель уже существовал, просто меняем трек
        await videoSender.replaceTrack(videoTrack);
      } else {
        // Если видео еще не отправлялось, добавляем трек
        peerConnection.addTrack(videoTrack, screenStream);
        
        // Пересогласовываем связь, так как добавился новый тип медиа (видео)
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { offer: offer });
      }

      // Если пользователь вручную отключит трансляцию в интерфейсе браузера
      videoTrack.onended = () => {
        stopScreenShare();
      };

      btnScreen.innerText = 'Остановить трансляцию';
      btnScreen.className = 'danger';
      isScreenSharing = true;

    } catch (err) {
      console.error('Ошибка трансляции экрана:', err);
    }
  } else {
    stopScreenShare();
  }
};

async function stopScreenShare() {
  if (!screenStream) return;
  
  screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;

  if (peerConnection) {
    const senders = peerConnection.getSenders();
    const videoSender = senders.find(s => s.track && s.track.kind === 'video');
    if (videoSender) {
      // Убираем видеопоток
      await videoSender.replaceTrack(null);
    }
  }

  btnScreen.innerText = 'Транслировать экран';
  btnScreen.className = '';
  isScreenSharing = false;
}