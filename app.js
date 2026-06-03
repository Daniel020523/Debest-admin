import { FilesetResolver, FaceLandmarker } from "https://esm.sh/@mediapipe/tasks-vision@0.10.8";

// ── Supabase credentials ──────────────────────────────────────────────────────
// Replace with your real JWT anon key from:
// Supabase Dashboard → Project Settings → API → anon/public key (starts with "eyJ...")
const SUPABASE_URL      = "https://dmavecishluzeqdddaqy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aTPFO65SpkKXmku2Nm7XGQ_tgRcXpFg";

const supabase     = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const faceChannel  = supabase.channel("puppeteer-room-1", {
    config: { broadcast: { self: false } },
});

faceChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
        console.log("✅ Connected to real-time bridge!");
        dataOutput.innerText = "✅ Real-time bridge connected. Start camera to begin tracking.";
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("❌ Supabase channel error:", status);
        dataOutput.innerText = `⚠️ Real-time connection failed (${status}). Check your ANON KEY.`;
    }
});

// ── DOM refs ──────────────────────────────────────────────────────────────────
const video       = document.getElementById("webcam");
const startButton = document.getElementById("startButton");
const dataOutput  = document.getElementById("coordinates");

let faceLandmarker   = null;
let isTracking       = false;
let lastBroadcastTime = 0;
const BROADCAST_INTERVAL_MS = 50; // ~20fps broadcast max

// ── Init MediaPipe FaceLandmarker ─────────────────────────────────────────────
async function initializeFaceTracker() {
    try {
        dataOutput.innerText = "Loading AI models… please wait.";

        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );

        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                // FIX #4: GPU crashes silently on many mobile/iOS browsers.
                // Fall back to CPU which is universally supported.
                delegate: "CPU",
            },
            // FIX #5: Correct property name is outputFacialTransformationMatrixes
            // (was outputTransformationMatrixes — wrong, causes matrix data to be undefined)
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: true,
            runningMode: "VIDEO",
            numFaces: 1,
        });

        dataOutput.innerText = "✅ AI Models loaded! Press Start Camera.";
        startButton.style.display = "block";
    } catch (error) {
        console.error("Init error:", error);
        dataOutput.innerText = "❌ Error loading models: " + error.message;
    }
}

// ── Start camera ──────────────────────────────────────────────────────────────
async function startCamera() {
    startButton.disabled = true;
    startButton.innerText = "Starting…";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
        });

        video.srcObject = stream;

        // FIX #1: Must call play() explicitly — stream won't start on its own
        // in many browsers, especially mobile Safari.
        await video.play();

        startButton.style.display = "none";
        dataOutput.innerText = "🎥 Camera running — tracking your face…";

        // FIX #2: Don't use async predictWebcam with rAF.
        // Start the synchronous loop only once video is confirmed playing.
        isTracking = true;
        requestAnimationFrame(trackLoop);

    } catch (err) {
        console.error("Camera error:", err);
        startButton.disabled  = false;
        startButton.innerText = "Start Camera";
        if (err.name === "NotAllowedError") {
            dataOutput.innerText = "⚠️ Camera permission denied. Allow access and try again.";
        } else if (err.name === "NotFoundError") {
            dataOutput.innerText = "⚠️ No camera found on this device.";
        } else {
            dataOutput.innerText = "⚠️ Camera error: " + err.message;
        }
    }
}

// ── Main tracking loop (synchronous, no async) ────────────────────────────────
// FIX #2: Pure sync function so requestAnimationFrame callback works correctly.
function trackLoop() {
    if (!isTracking) return;

    if (faceLandmarker && video.readyState >= 2) {
        // FIX #3: Use performance.now() as the timestamp directly instead of
        // relying on video.currentTime (which stays 0 on many mobile browsers).
        const nowMs = performance.now();
        const results = faceLandmarker.detectForVideo(video, nowMs);

        if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
            processResults(results);
        } else {
            dataOutput.innerText = "👀 No face detected — look directly at the camera.";
        }
    }

    requestAnimationFrame(trackLoop);
}

// ── Process & broadcast results ───────────────────────────────────────────────
function processResults(results) {
    const blendshapes = results.faceBlendshapes[0].categories;

    // Helper: find a blendshape score by name
    const get = (name) => blendshapes.find(s => s.categoryName === name)?.score || 0;

    const jawOpen         = get("jawOpen");
    const eyeBlinkLeft    = get("eyeBlinkLeft");
    const eyeBlinkRight   = get("eyeBlinkRight");
    const mouthSmileLeft  = get("mouthSmileLeft");
    const mouthSmileRight = get("mouthSmileRight");
    const mouthFrownLeft  = get("mouthFrownLeft");
    const mouthFrownRight = get("mouthFrownRight");

    let rotation = { yaw: 0, pitch: 0, roll: 0 };

    // FIX #5: Use corrected property name outputFacialTransformationMatrixes
    if (results.facialTransformationMatrixes?.length > 0) {
        const m = results.facialTransformationMatrixes[0].data;
        // Column-major 4×4 matrix from MediaPipe:
        // Yaw  (left/right turn) : atan2(-m[8],  m[0])
        // Pitch (up/down nod)    : atan2( m[6], m[10])
        // Roll  (tilt)           : atan2(-m[4],  m[5])
        rotation.yaw   = Math.atan2(-m[8],  m[0]);
        rotation.pitch = Math.atan2( m[6],  m[10]);
        rotation.roll  = Math.atan2(-m[4],  m[5]);
    }

    const avgSmile = (mouthSmileLeft + mouthSmileRight) / 2;

    dataOutput.innerText = `
[ HEAD ROTATION ]
Yaw  (turn) : ${(rotation.yaw   * 180 / Math.PI).toFixed(1)}°
Pitch (nod) : ${(rotation.pitch * 180 / Math.PI).toFixed(1)}°
Roll  (tilt): ${(rotation.roll  * 180 / Math.PI).toFixed(1)}°

[ EXPRESSIONS ]
Jaw Open    : ${jawOpen.toFixed(2)}
Blink Left  : ${eyeBlinkLeft.toFixed(2)}
Blink Right : ${eyeBlinkRight.toFixed(2)}
Smile       : ${avgSmile.toFixed(2)}
    `.trim();

    // Throttle broadcast
    const now = performance.now();
    if (now - lastBroadcastTime < BROADCAST_INTERVAL_MS) return;
    lastBroadcastTime = now;

    faceChannel.send({
        type: "broadcast",
        event: "face-move",
        payload: {
            rotation,
            expressions: {
                jawOpen,
                eyeBlinkLeft,
                eyeBlinkRight,
                mouthSmileLeft,
                mouthSmileRight,
                mouthFrownLeft,
                mouthFrownRight,
            },
        },
    });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initializeFaceTracker();
startButton.addEventListener("click", startCamera);
