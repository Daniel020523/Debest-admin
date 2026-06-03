import { FilesetResolver, FaceLandmarker } from "https://esm.sh/@mediapipe/tasks-vision@0.10.8";

// 1. Initialize Supabase Client
// REPLACE THESE placeholders with your actual Supabase Project URL and Anon Key
const SUPABASE_URL = "https://dmavecishluzeqdddaqy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aTPFO65SpkKXmku2Nm7XGQ_tgRcXpFg";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Create a unique room channel so your phone and laptop connect to the same place
const faceChannel = supabase.channel('puppeteer-room-1', {
  config: { broadcast: { self: false } }, // Don't send data back to ourselves
});

// Subscribe to the channel
faceChannel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    console.log('Connected to real-time bridge!');
  }
});

const video = document.getElementById("webcam");
const startButton = document.getElementById("startButton");
const dataOutput = document.getElementById("coordinates");

let faceLandmarker;
let runningMode = "VIDEO";
let lastVideoTime = -1;

async function initializeFaceTracker() {
    try {
        dataOutput.innerText = "Loading AI Models... Please wait.";
        
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU"
            },
            outputFaceBlendshapes: true,
            outputTransformationMatrixes: true,
            runningMode: runningMode,
            numFaces: 1
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
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
    };
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
        startButton.style.display = "none";
    } catch (err) {
        console.error("Error accessing camera: ", err);
        dataOutput.innerText = "Camera access denied or unavailable.";
    }
}

async function predictWebcam() {
    let startTimeMs = performance.now();
    
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
    
    const jawOpen = blendshapes.find(shape => shape.categoryName === "jawOpen")?.score || 0;
    const eyeBlinkLeft = blendshapes.find(shape => shape.categoryName === "eyeBlinkLeft")?.score || 0;
    const eyeBlinkRight = blendshapes.find(shape => shape.categoryName === "eyeBlinkRight")?.score || 0;
    
    let rotation = { yaw: 0, pitch: 0 };
    let rotationText = "Calculating angle...";
    
    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        const matrix = results.facialTransformationMatrixes[0].data;
        rotation.yaw = Math.atan2(-matrix[2], matrix[0]);   
        rotation.pitch = Math.atan2(-matrix[6], matrix[10]); 
        
        rotationText = `Yaw (Turn): ${rotation.yaw.toFixed(2)} | Pitch (Nod): ${rotation.pitch.toFixed(2)}`;
    }

    dataOutput.innerText = `
[ HEAD POSITION ]
${rotationText}

[ EXPRESSIONS (0.0 to 1.0) ]
Mouth Open (Jaw): ${jawOpen.toFixed(2)}
Left Eye Blink : ${eyeBlinkLeft.toFixed(2)}
Right Eye Blink: ${eyeBlinkRight.toFixed(2)}
    `;

    // 🔥 STREAM DATA LIVE OVER THE NETWORK TO THE LAPTOP
    faceChannel.send({
      type: 'broadcast',
      event: 'face-move',
      payload: {
        rotation: rotation,
        expressions: {
          jawOpen: jawOpen,
          eyeBlinkLeft: eyeBlinkLeft,
          eyeBlinkRight: eyeBlinkRight
        }
      }
    });
}

initializeFaceTracker();
startButton.addEventListener("click", startCamera);
