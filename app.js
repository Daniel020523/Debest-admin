import { FilesetResolver, FaceLandmarker } from "https://esm.sh/@mediapipe/tasks-vision@0.10.8";

const SUPABASE_URL      = "https://dmavecishluzeqdddaqy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aTPFO65SpkKXmku2Nm7XGQ_tgRcXpFg"; // replace with real eyJ... key

const supabase    = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const faceChannel = supabase.channel("puppeteer-room-1", {
  config: { broadcast: { self: false } },
});

faceChannel.subscribe(s => {
  if (s === "SUBSCRIBED") {
    log("✅ Bridge connected");
    dataOutput.innerText = "✅ Connected. Press Start Camera.";
  } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
    dataOutput.innerText = `⚠️ Channel ${s} — check ANON KEY`;
  }
});

const video       = document.getElementById("webcam");
const startButton = document.getElementById("startButton");
const dataOutput  = document.getElementById("coordinates");

let faceLandmarker = null;
let isTracking     = false;
let lastSendTime   = 0;
const SEND_INTERVAL = 33; // ~30fps

function log(m){ console.log("[tracker]", m); }

async function init() {
  try {
    dataOutput.innerText = "Loading AI models…";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "CPU",
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: "VIDEO",
      numFaces: 1,
    });
    dataOutput.innerText = "✅ Models loaded. Press Start Camera.";
    startButton.style.display = "block";
  } catch(e) {
    dataOutput.innerText = "❌ Model error: " + e.message;
  }
}

async function startCamera() {
  startButton.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode:"user", width:{ideal:640}, height:{ideal:480} }
    });
    video.srcObject = stream;
    await video.play();
    startButton.style.display = "none";
    isTracking = true;
    requestAnimationFrame(loop);
  } catch(e) {
    startButton.disabled = false;
    dataOutput.innerText = (e.name === "NotAllowedError")
      ? "⚠️ Camera permission denied."
      : "⚠️ Camera error: " + e.message;
  }
}

function loop() {
  if (!isTracking) return;
  if (faceLandmarker && video.readyState >= 2) {
    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (results.faceBlendshapes?.length > 0) {
      process(results);
    } else {
      dataOutput.innerText = "👀 No face detected.";
    }
  }
  requestAnimationFrame(loop);
}

function process(results) {
  const bs = results.faceBlendshapes[0].categories;
  const get = name => bs.find(s => s.categoryName === name)?.score || 0;

  const jawOpen         = get("jawOpen");
  const eyeBlinkLeft    = get("eyeBlinkLeft");
  const eyeBlinkRight   = get("eyeBlinkRight");
  const mouthSmileLeft  = get("mouthSmileLeft");
  const mouthSmileRight = get("mouthSmileRight");
  const mouthFrownLeft  = get("mouthFrownLeft");
  const mouthFrownRight = get("mouthFrownRight");
  const browDownLeft    = get("browDownLeft");
  const browDownRight   = get("browDownRight");
  const browInnerUp     = get("browInnerUp");
  const cheekPuff       = get("cheekPuff");

  let rotation = { yaw:0, pitch:0, roll:0 };
  if (results.facialTransformationMatrixes?.length > 0) {
    const m = results.facialTransformationMatrixes[0].data;
    rotation.yaw   = Math.atan2(-m[8],  m[0]);
    rotation.pitch = Math.atan2( m[6],  m[10]);
    rotation.roll  = Math.atan2(-m[4],  m[5]);
  }

  // Send normalised landmarks (x,y,z) — the key data for mesh warping
  // Only send every SEND_INTERVAL ms
  const now = performance.now();
  if (now - lastSendTime < SEND_INTERVAL) return;
  lastSendTime = now;

  // Normalise landmarks to 0-1 range
  const lm = results.faceLandmarks[0].map(p => ({
    x: p.x, y: p.y, z: p.z
  }));

  faceChannel.send({
    type: "broadcast",
    event: "face-move",
    payload: {
      landmarks: lm,          // 468 points for mesh warping
      rotation,
      expressions: {
        jawOpen, eyeBlinkLeft, eyeBlinkRight,
        mouthSmileLeft, mouthSmileRight,
        mouthFrownLeft, mouthFrownRight,
        browDownLeft, browDownRight,
        browInnerUp, cheekPuff,
      }
    }
  });

  dataOutput.innerText = `
YAW ${(rotation.yaw*57.3).toFixed(1)}°  PITCH ${(rotation.pitch*57.3).toFixed(1)}°  ROLL ${(rotation.roll*57.3).toFixed(1)}°
JAW  ${jawOpen.toFixed(2)}  BLINK L ${eyeBlinkLeft.toFixed(2)}  R ${eyeBlinkRight.toFixed(2)}
SMILE ${((mouthSmileLeft+mouthSmileRight)/2).toFixed(2)}
LANDMARKS: ${lm.length} points sent`.trim();
}

init();
startButton.addEventListener("click", startCamera);
