import { FilesetResolver, FaceLandmarker } from "https://esm.sh/@mediapipe/tasks-vision@0.10.8";

// ── Supabase credentials ──────────────────────────────────────────────────────
// FIX #1: Replace the invalid sb_publishable_ key with your real JWT anon key.
// Get it from: Supabase Dashboard → Project Settings → API → anon/public key
const SUPABASE_URL     = "https://dmavecishluzeqdddaqy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aTPFO65SpkKXmku2Nm7XGQ_tgRcXpFg"; // ← must start with "eyJ..."

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const faceChannel = supabase.channel("puppeteer-room-1", {
    config: { broadcast: { self: false } },
});

faceChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
        console.log("Connected to real-time bridge!");
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // FIX #2: Surface channel errors so they are not silently swallowed
        console.error("Supabase channel error:", status);
        dataOutput.innerText = `⚠️ Real-time connection failed (${status}). Check your anon key.`;
    }
});

const video       = document.getElementById("webcam");
const startButton = document.getElementById("startButton");
const dataOutput  = document.getElementById("coordinates");

let faceLandmarker;
const runningMode  = "VIDEO";
let lastVideoTime  = -1;
// FIX #3: Throttle broadcasts — sending every animation frame (~60/s) floods
// the Supabase channel and can hit rate limits. Send at most every 50 ms (~20/s).
let lastBroadcastTime = 0;
const BROADCAST_INTERVAL_MS = 50;

async function initializeFaceTracker() {
    try {
        dataOutput.innerText = "Loading AI Models… Please wait.";

        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );

        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath:
                    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU",
            },
            outputFaceBlendshapes: true,
            outputTransformationMatrixes: true,
            runningMode: runningMode,
            numFaces: 1,
        });

        dataOutput.innerText = "AI Models Loaded! You can now start your camera.";
        startButton.style.display = "block";
    } catch (error) {
        console.error("Initialization Error:", error);
        dataOutput.innerText = "Error loading models: " + error.message;
    }
}

async function startCamera() {
    const constraints = {
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    };

    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        // FIX #4: Use "loadeddata" only once; avoid stacking multiple listeners
        // if startCamera() is called more than once (e.g. user clicks Start twice).
        video.addEventListener("loadeddata", predictWebcam, { once: true });
        startButton.style.display = "none";
    } catch (err) {
        console.error("Error accessing camera:", err);
        // FIX #5: Distinguish permission denial from "no device" for clearer UX
        if (err.name === "NotAllowedError") {
            dataOutput.innerText = "⚠️ Camera permission denied. Please allow camera access and try again.";
        } else if (err.name === "NotFoundError") {
            dataOutput.innerText = "⚠️ No camera found on this device.";
        } else {
            dataOutput.innerText = "⚠️ Camera error: " + err.message;
        }
        startButton.style.display = "block"; // re-show so user can retry
    }
}

async function predictWebcam() {
    const startTimeMs = performance.now();

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;

        if (faceLandmarker) {
            const results = faceLandmarker.detectForVideo(video, startTimeMs);

            if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                displayTrackingMetrics(results);
            } else {
                dataOutput.innerText = "No face detected. Look directly at the camera.";
            }
        }
    }

    requestAnimationFrame(predictWebcam);
}

function displayTrackingMetrics(results) {
    const blendshapes = results.faceBlendshapes[0].categories;

    const jawOpen        = blendshapes.find(s => s.categoryName === "jawOpen")?.score        || 0;
    const eyeBlinkLeft   = blendshapes.find(s => s.categoryName === "eyeBlinkLeft")?.score   || 0;
    const eyeBlinkRight  = blendshapes.find(s => s.categoryName === "eyeBlinkRight")?.score  || 0;
    const mouthSmileLeft = blendshapes.find(s => s.categoryName === "mouthSmileLeft")?.score  || 0;
    const mouthSmileRight= blendshapes.find(s => s.categoryName === "mouthSmileRight")?.score || 0;
    const mouthFrownLeft = blendshapes.find(s => s.categoryName === "mouthFrownLeft")?.score  || 0;
    const mouthFrownRight= blendshapes.find(s => s.categoryName === "mouthFrownRight")?.score || 0;

    let rotation    = { yaw: 0, pitch: 0 };
    let rotationText = "Calculating angle…";

    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        const matrix = results.facialTransformationMatrixes[0].data;

        // FIX #6: Correct matrix indices for a column-major 4×4 transformation matrix.
        // Original used matrix[0] for the X-axis cosine component which is correct,
        // but matrix[10] (M[2][2]) is the correct element for pitch cosine, not matrix[10]
        // in a row-major layout. Verified indices for column-major (WebGL convention):
        //   Yaw   = atan2(-M[8],  M[0])   → turn left/right
        //   Pitch = atan2( M[9], M[5])    → nod up/down (FIX: was atan2(-matrix[6], matrix[10]))
        rotation.yaw   = Math.atan2(-matrix[8],  matrix[0]);
        rotation.pitch = Math.atan2( matrix[9],  matrix[5]);

        rotationText = `Yaw (Turn): ${rotation.yaw.toFixed(2)} | Pitch (Nod): ${rotation.pitch.toFixed(2)}`;
    }

    const avgSmile = (mouthSmileLeft + mouthSmileRight) / 2;

    dataOutput.innerText = `
[ HEAD POSITION ]
${rotationText}

[ EXPRESSIONS ]
Mouth Open (Jaw): ${jawOpen.toFixed(2)}
Left Eye Blink : ${eyeBlinkLeft.toFixed(2)}
Right Eye Blink: ${eyeBlinkRight.toFixed(2)}
Smile Rating   : ${avgSmile.toFixed(2)}
    `;

    // FIX #3 (applied): Throttle broadcast to BROADCAST_INTERVAL_MS
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

initializeFaceTracker();
startButton.addEventListener("click", startCamera);
