const video = document.getElementById("camera");
const canvas = document.getElementById("mask");
const ctx = canvas.getContext("2d");
const timeNodes = document.querySelectorAll(".js-time");
const dateNodes = document.querySelectorAll(".js-date");
const audio = document.getElementById("bgAudio");

const state = {
  landmarker: null,
  running: false,
  lastFace: null,
  lastTime: 0,
};
const audioUnlockEvents = ["pointerdown", "touchstart", "keydown"];

function formatTime(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDate(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function updateClock() {
  const now = new Date();
  const timeText = formatTime(now);
  const dateText = formatDate(now);
  timeNodes.forEach((node) => {
    node.textContent = timeText;
  });
  dateNodes.forEach((node) => {
    node.textContent = dateText;
  });
}

updateClock();
setInterval(updateClock, 60 * 1000);

function resizeCanvas() {
  const width = video.clientWidth || video.videoWidth;
  const height = video.clientHeight || video.videoHeight;
  if (width && height) {
    canvas.width = width;
    canvas.height = height;
  }
}

window.addEventListener("resize", () => {
  resizeCanvas();
});

async function startCamera() {
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };

  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  resizeCanvas();
}

async function initLandmarker() {
  if (!window.vision) {
    throw new Error("MediaPipe Vision не загрузился");
  }

  const filesetResolver = await vision.FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  state.landmarker = await vision.FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm/face_landmarker.task",
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawMask(face) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(108, 0, 0, 0.6)";
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.1, w * 0.5, h * 0.5, w * 0.85);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  if (face) {
    ctx.globalCompositeOperation = "screen";
    ctx.save();
    ctx.translate(face.x, face.y);
    ctx.scale(1, face.ry / face.rx);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, face.rx);
    glow.addColorStop(0, "rgba(255, 255, 255, 0.28)");
    glow.addColorStop(0.6, "rgba(255, 255, 255, 0.12)");
    glow.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, face.rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function computeFace(landmarks) {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const lm of landmarks) {
    if (lm.x < minX) minX = lm.x;
    if (lm.y < minY) minY = lm.y;
    if (lm.x > maxX) maxX = lm.x;
    if (lm.y > maxY) maxY = lm.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  return {
    x: cx * canvas.width,
    y: cy * canvas.height,
    rx: (boxW * canvas.width * 0.5) * 1.2,
    ry: (boxH * canvas.height * 0.5) * 1.4,
  };
}

async function renderFrame(now) {
  if (!state.running) return;

  if (video.readyState >= 2 && state.landmarker) {
    const result = await state.landmarker.detectForVideo(video, now);
    const landmarks = result.faceLandmarks?.[0];

    if (landmarks) {
      const nextFace = computeFace(landmarks);
      if (!state.lastFace) {
        state.lastFace = nextFace;
      } else {
        state.lastFace = {
          x: lerp(state.lastFace.x, nextFace.x, 0.2),
          y: lerp(state.lastFace.y, nextFace.y, 0.2),
          rx: lerp(state.lastFace.rx, nextFace.rx, 0.2),
          ry: lerp(state.lastFace.ry, nextFace.ry, 0.2),
        };
      }
    } else {
      state.lastFace = null;
    }
  }

  drawMask(state.lastFace);
  requestAnimationFrame(renderFrame);
}

async function tryAutoplay() {
  if (!audio || !audio.src) return;

  audio.preload = "auto";
  audio.load();

  try {
    audio.muted = false;
    await audio.play();
    return;
  } catch (err) {
    // Browser requires user gesture before playing audio with sound.
  }

  const unlock = async () => {
    audio.muted = false;
    try {
      await audio.play();
    } catch (e) {
      // ignore
    }
  };

  for (const eventName of audioUnlockEvents) {
    window.addEventListener(eventName, unlock, { once: true, passive: true });
  }
}

async function init() {
  tryAutoplay();
  await startCamera();
  state.running = true;
  requestAnimationFrame(renderFrame);
  try {
    await initLandmarker();
  } catch (err) {
    console.warn("Face Landmarker init failed:", err);
  }
}

init().catch((err) => {
  console.error(err);
});
