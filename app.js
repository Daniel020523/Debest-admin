// Grab MediaPipe from the global window object loaded by index.html (Safari friendly)
const FaceLandmarker = mpVision.FaceLandmarker;
const FilesetResolver = mpVision.FilesetResolver;

const video = document.getElementById("webcam");
const startButton = document.getElementById("startButton");
const dataOutput = document.getElementById("coordinates");

let faceLandmarker;
let runningMode = "VIDEO";
let lastVideoTime = -1;

// 1. Initialize the MediaPipe AI Model
async function initializeFaceTracker() {
    try {
        dataOutput.innerText = "Loading AI Models... Please wait.";
        
        // Fetch the fileset required for the vision tasks
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
        );
        
        // Configure and load the Face Landmarker model
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "GPU" // Uses iPhone's hardware acceleration for speed
            },
            outputFaceBlendshapes: true, // Crucial for eye/mouth tracking
            outputTransformationMatrixes: true, // Crucial for 3D head rotation
            runningMode: runningMode,
            numFaces: 1
        });
        
        dataOutput.innerText = "AI Models Loaded! You can now start your camera.";
        startButton.style.display = "block";
    } catch (error) {
        console.error(error);
        dataOutput.innerText = "Error loading models: " + error.message;
    }
}

// 2. Activate Phone Camera
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
        dataOutput.innerText = "Camera access denied or unavailable. Make sure Safari has camera permissions.";
    }
}

// 3. The Core Tracking Loop (Runs continuously)
async function predictWebcam() {
    let startTimeMs = performance.now();
    
    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        
        if (faceLandmarker) {
            const results = faceLandmarker.detectForVideo(video, startTimeMs);
            
            // If a face is found, parse and display the math data
            if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                displayTrackingMetrics(results);
            } else {
                dataOutput.innerText = "No face detected. Look directly at the camera.";
            }
        }
    }
    
    // Keep looping smoothly at the device's native frame rate
    requestAnimationFrame(predictWebcam);
}

// 4. Extract and format the specific numbers we need
function displayTrackingMetrics(results) {
    const blendshapes = results.faceBlendshapes[0].categories;
    
    // Find the specific facial movements we want to monitor
    const jawOpen = blendshapes.find(shape => shape.categoryName === "jawOpen")?.score || 0;
    const eyeBlinkLeft = blendshapes.find(shape => shape.categoryName === "eyeBlinkLeft")?.score || 0;
    const eyeBlinkRight = blendshapes.find(shape => shape.categoryName === "eyeBlinkRight")?.score || 0;
    
    // Grab the 3D Transformation Matrix to deduce head rotation angles
    let rotationText = "Calculating angle...";
    if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        const matrix = results.facialTransformationMatrixes[0].data;
        // Simple extraction of tilt/turn values from the matrix geometry
        const yaw = Math.atan2(-matrix[2], matrix[0]).toFixed(2);   // Side-to-side turn
        const pitch = Math.atan2(-matrix[6], matrix[10]).toFixed(2); // Up-and-down nod
        
        rotationText = `Yaw (Turn): ${yaw} | Pitch (Nod): ${pitch}`;
    }

    // Print the raw values to the screen so we can confirm it works
    dataOutput.innerText = `
[ HEAD POSITION ]
${rotationText}

[ EXPRESSIONS (0.0 to 1.0) ]
Mouth Open (Jaw): ${jawOpen.toFixed(2)}
Left Eye Blink : ${eyeBlinkLeft.toFixed(2)}
Right Eye Blink: ${eyeBlinkRight.toFixed(2)}
    `;
}

// Initialize on page load
initializeFaceTracker();
startButton.addEventListener("click", startCamera);
