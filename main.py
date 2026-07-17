from __future__  import annotations
import base64
import io
import os
import random
import sqlite3
import uuid
import time
from pathlib import Path
from threading import Lock
from typing import Dict, List

import cv2
import numpy as np
import torch
import torch.nn as nn
import torchvision.models as models
from PIL import Image
from flask import Flask, jsonify, render_template, request, make_response

from torchvision import transforms

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "new_trained_model.pth"
IMAGE_SIZE = 224
FACE_CROP_MARGIN = 0.2
TOP_K = 3
QUOTE_BANK: Dict[str, List[str]] = {
    "angry": [
        "Take one breath with me. You are still in control of this moment.",
        "Your anger is real, and you deserve space to calm safely.",
        "You are not a bad person for feeling angry. You are human.",
        "Pause first, respond next. Your peace matters right now.",
        "This feeling have come, but you have the power to control it",
    ],
    "disgust": [
        "Your discomfort is valid. Trust yourself to step back if needed.",
        "You can protect your peace without being hard on yourself.",
        "Take distance, breathe, and return only when you feel ready.",
    ],
    "fear": [
        "You are safe to take this one step at a time.",
        "Feeling scared does not mean you are weak. You are still brave.",
        "Small steady steps are enough. You do not need to rush.",
        "Your body is asking for care, and you are listening well.",g
       "Even with fear present, you are still moving forward.",
        "It's okay to feel this way.Just take a deep breath and let it pass. You are stronger than you think.",
    ],
    "happy": [
        "This light in you is beautiful. Let it stay for a while.",
        "You deserve this joy. Hold it gently and enjoy it fully.",
        "Celebrate yourself. This feeling is meaningful.",
        "Moments like this can refill your strength. Keep it close.",
        "Your happy moments matter, and they are worth remembering.",
    ],
    "neutral": [
        "You seem grounded right now, and that is powerful.",
        "Calm moments are not empty. They are where clarity grows.",
        "You are in a steady state. Trust your next choice.",
    ],
    "sad": [
        "It is okay to feel this. You do not have to hide it here.",
        "Be gentle with yourself today. Soft progress is still progress.",
        "You are allowed to rest while you heal.",
        "One hard day does not define your whole story.",
    ],
    "surprise": [
        "That was unexpected, and your reaction makes sense.",
        "Take a second to settle. You are adapting well.",
        "Sometimes surprises open space for a better next step.",
    ],
}


app = Flask(__name__, template_folder="templates", static_folder="static")
assets_lock = Lock()
DB_PATH = BASE_DIR / "emotionsense.db"
model: nn.Module | None = None
classes: np.ndarray | None = None

# Internal OpenCV Face Detector (No external files required)
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

transform = transforms.Compose(
    [
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE), interpolation=transforms.InterpolationMode.BILINEAR),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ]
)

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                emotion TEXT,
                confidence REAL,
                quote TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)


def build_model(num_classes: int) -> nn.Module:
    network = models.resnet18(weights=None)
    in_features = network.fc.in_features
    network.fc = nn.Linear(in_features, num_classes)
    return network


def decode_base64_image(data_url: str) -> Image.Image:
    if "," not in data_url:
        raise ValueError("Invalid image payload.")

    _, encoded = data_url.split(",", 1)
    raw = base64.b64decode(encoded)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def detect_and_crop_face(image: Image.Image) -> Image.Image:
    """Detect face with OpenCV Cascade and crop for ResNet-18 inference."""
    opencv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    image_h, image_w = opencv_image.shape[:2]

    # Quality Check: Ensure environment is well-lit
    gray = cv2.cvtColor(opencv_image, cv2.COLOR_BGR2GRAY)
    avg_brightness = np.mean(gray)
    if avg_brightness < 45:
        raise ValueError("Environment too dark. Please ensure you are in a well-lit area.")

    # Internal Cascade detection
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))

    if len(faces) == 0:
        raise ValueError("No face detected. Please ensure your face is clearly visible and centered.")

    # Get the largest face (closest to camera)
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    (x, y, w, h) = faces[0]
    x1, y1, x2, y2 = x, y, x + w, y + h

    # Sanity check on size
    face_area_ratio = (w * h) / (image_w * image_h)
    if face_area_ratio < 0.05:
        raise ValueError("Face is too far away. Please move closer to the camera.")
    
    # Check if detection is centered (optional, but good for ResNet)
    # We want the face center to be within the middle 40% of the screen
    center_x = x1 + w / 2
    center_y = y1 + h / 2
    if abs(center_x - image_w / 2) > (image_w * 0.20) or abs(center_y - image_h / 2) > (image_h * 0.25):
        raise ValueError("Please center your face in the green guide box.")

    # Add margin for ResNet18 context
    margin_w = int(FACE_CROP_MARGIN * w)
    margin_h = int(FACE_CROP_MARGIN * h)
    crop_x1 = max(0, x1 - margin_w)
    crop_y1 = max(0, y1 - margin_h)
    crop_x2 = min(image_w, x2 + margin_w)
    crop_y2 = min(image_h, y2 + margin_h)

    cropped_face = opencv_image[crop_y1:crop_y2, crop_x1:crop_x2]
    return Image.fromarray(cv2.cvtColor(cropped_face, cv2.COLOR_BGR2RGB))


def choose_quote(emotion: str) -> str:
    options = QUOTE_BANK.get(emotion)
    if not options:
        return "Keep going. You are doing better than you think."
    return random.choice(options)


def load_assets() -> tuple[nn.Module, np.ndarray]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")

    classes = np.array(['angry', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'])

    # Optimization: Set threads for better CPU performance in Flask
    torch.set_num_threads(1)

    loaded_model = build_model(len(classes))
    state_dict = torch.load(MODEL_PATH, map_location="cpu")
    loaded_model.load_state_dict(state_dict, strict=True)
    loaded_model.eval()

    # Optimization: Warm-up the model with a dummy tensor
    with torch.no_grad():
        dummy_input = torch.randn(1, 3, IMAGE_SIZE, IMAGE_SIZE)
        loaded_model(dummy_input)

    return loaded_model, classes


def ensure_assets_loaded() -> None:
    global model, classes

    if model is not None and classes is not None:
        return

    with assets_lock:
        if model is not None and classes is not None:
            return

        model, classes = load_assets()


@app.get("/")
def home() -> str:
    user_id = request.cookies.get("user_id")
    resp = make_response(render_template("index.html"))
    
    if not user_id:
        user_id = str(uuid.uuid4())
        # Set cookie for 1 year
        resp.set_cookie("user_id", user_id, max_age=60*60*24*365, httponly=True, samesite='Lax')
        with get_db() as conn:
            conn.execute("INSERT OR IGNORE INTO users (id) VALUES (?)", (user_id,))
    
    return resp

@app.get("/api/health")
def health() -> tuple:
    if classes is None:
        return jsonify({"status": "ok", "model_loaded": False, "classes": []}), 200

    return jsonify({"status": "ok", "model_loaded": True, "classes": list(classes)}), 200


@app.post("/api/predict")
def predict() -> tuple:
    start_time = time.perf_counter()
    ensure_assets_loaded()
    user_id = request.cookies.get("user_id")
    if not user_id:
        return jsonify({"detail": "Session expired. Please refresh the page."}), 401

    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image")
    client_start_time = payload.get("client_start_time")
    if not image_data:
        return jsonify({"detail": "Invalid image data: missing image field."}), 400

    try:
        image = decode_base64_image(image_data)
        # Detect and crop face
        image = detect_and_crop_face(image)
    except Exception as exc:
        return jsonify({"detail": f"Invalid image data: {exc}"}), 400

    x = transform(image).unsqueeze(0)

    assert model is not None
    assert classes is not None

    # Optimization: Use inference_mode for faster execution
    with torch.inference_mode():
        logits = model(x)
        probs = torch.softmax(logits, dim=1).squeeze(0)

    top_probs, top_indices = torch.topk(probs, k=min(TOP_K, probs.numel()))
    top_probs = top_probs.cpu().numpy().tolist()
    top_indices = top_indices.cpu().numpy().tolist()

    primary_idx = top_indices[0]
    emotion = str(classes[primary_idx])
    quote = choose_quote(emotion)
    confidence = round(top_probs[0] * 100.0, 2)

    # Save to Database for specific user
    with get_db() as conn:
        conn.execute(
            "INSERT INTO history (user_id, emotion, confidence, quote) VALUES (?, ?, ?, ?)",
            (user_id, emotion, confidence, quote)
        )

    # Calculate Latency
    backend_ms = (time.perf_counter() - start_time) * 1000
    
    print("\n" + "="*40)
    print(f" LATENCY REPORT - Emotion: {emotion.upper()}")
    print("-" * 40)
    print(f" 1. Backend Processing: {backend_ms:.2f}ms")
    if client_start_time:
        total_latency = (time.time() * 1000) - client_start_time
        print(f" 2. Total End-to-End:  {total_latency:.2f}ms")
    print("="*40 + "\n")

    return (
        jsonify(
            {
                "emotion": emotion,
                "confidence": confidence,
                "quote": quote,
                "backend_ms": round(backend_ms, 2),
                "top_predictions": [
                    {
                        "emotion": str(classes[idx]),
                        "confidence": round(prob * 100.0, 2),
                    }
                    for idx, prob in zip(top_indices, top_probs)
                ],
            }
        ),
        200,
    )


@app.get("/api/quotes/<emotion>")
def get_quotes(emotion: str) -> tuple:
    emotion = emotion.lower()
    if emotion not in QUOTE_BANK:
        return jsonify({"detail": "Emotion not found"}), 404

    quotes = QUOTE_BANK[emotion]
    return jsonify({"emotion": emotion, "quotes": quotes}), 200

@app.post("/api/check-alignment")
def check_alignment() -> tuple:
    """Lightweight endpoint to check if face is centered without full prediction."""
    payload = request.get_json(silent=True) or {}
    image_data = payload.get("image")
    if not image_data:
        return jsonify({"aligned": False}), 400

    try:
        image = decode_base64_image(image_data)
        # This will raise ValueError if lighting, distance, or centering is wrong
        detect_and_crop_face(image)
        return jsonify({"aligned": True}), 200
    except Exception as exc:
        # Return the specific reason so the UI can show it if needed
        return jsonify({"aligned": False, "reason": str(exc)}), 200

@app.get("/api/history")
def get_user_history():
    user_id = request.cookies.get("user_id")
    if not user_id:
        return jsonify([]), 200
    
    with get_db() as conn:
        rows = conn.execute(
            "SELECT emotion, confidence, quote as supportMessage, created_at as capturedAt FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
            (user_id,)
        ).fetchall()
        return jsonify([dict(row) for row in rows]), 200

@app.post("/api/history/clear")
def clear_history():
    user_id = request.cookies.get("user_id")
    if not user_id:
        return jsonify({"status": "error", "message": "No session found"}), 400
    
    with get_db() as conn:
        conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
    
    return jsonify({"status": "success", "message": "History cleared"}), 200

if __name__ == "__main__":
    init_db()
    ensure_assets_loaded()
    print("Starting EmotionSense app...")
    port = int(os.getenv("PORT", "8010"))
    print(f"Running on http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=True)
