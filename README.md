# EmotionSense Web App (Flask)

This project runs real-time emotion detection from webcam frames using your trained RAF-DB ResNet18 model, then generates a motivational quote based on the detected emotion.

## Files used
- `new_trained_model.pth`
- `label_encoder.pkl`
- `main.py`
- `templates/index.html`
- `static/style.css`
- `static/app.js`

## Setup
1. (Optional) create and activate a virtual environment:
   - Windows PowerShell:
     - `python -m venv .venv`
     - `.\.venv\Scripts\Activate.ps1`
2. Install dependencies:
   - `python -m pip install -r requirements.txt`
   - `pip install matplotlib seaborn numpy`
3. Run the app:
   - `python main.py`
4. (Optional) Generate Evaluation Heatmap:
   - `python visualize_metrics.py`
5. Open in browser:
   - `http://127.0.0.1:8010`

## API endpoints
- `GET /api/health`
- `POST /api/predict`

## Notes
- The browser must allow camera permission.
- If `label_encoder.pkl` version warnings appear, you can still run if classes load correctly.
