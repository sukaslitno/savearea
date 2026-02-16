const video = document.getElementById("camera");
const canvas = document.getElementById("mask");
const ctx = canvas.getContext("2d");
const timeNow = document.getElementById("timeNow");
const dateNow = document.getElementById("dateNow");
const audio = document.getElementById("bgAudio");

const state = {
  landmarker: null,
  running: false,
  lastFace: null,
  lastTime: 0,
};

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
  timeNow.textContent = formatTime(now);
  dateNow.textContent = formatDate(now);
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
  const gradient = ctx.createRadialGradient(w * 0.6, h * 0.5, w * 0.1, w * 0.5, h * 0.5, w * 0.8);
  gradient.addColorStop(0, "rgba(140, 20, 32, 0.7)");
  gradient.addColorStop(0.6, "rgba(80, 12, 20, 0.65)");
  gradient.addColorStop(1, "rgba(40, 6, 12, 0.9)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  if (face) {
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(face.x, face.y, face.r * 1.1, face.r * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
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
  const radius = Math.max(maxX - minX, maxY - minY) / 2;

  return {
    x: cx * canvas.width,
    y: cy * canvas.height,
    r: radius * Math.max(canvas.width, canvas.height),
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
          x: lerp(state.lastFace.x, nextFace.x, 0.15),
          y: lerp(state.lastFace.y, nextFace.y, 0.15),
          r: lerp(state.lastFace.r, nextFace.r, 0.15),
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
  try {
    if (audio && audio.src) {
      audio.muted = true;
      await audio.play();
      const unmute = () => {
        audio.muted = false;
        window.removeEventListener("pointerdown", unmute);
        window.removeEventListener("touchstart", unmute);
      };
      window.addEventListener("pointerdown", unmute, { once: true });
      window.addEventListener("touchstart", unmute, { once: true });
    }
  } catch (err) {
    const unlock = async () => {
      try {
        await audio.play();
      } catch (e) {
        // ignore
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
  }
}

async function init() {
  await startCamera();
  state.running = true;
  requestAnimationFrame(renderFrame);
  try {
    await initLandmarker();
  } catch (err) {
    console.warn("Face Landmarker init failed:", err);
  }
  tryAutoplay();
}

init().catch((err) => {
  console.error(err);
});
