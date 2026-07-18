const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const faceBox = document.getElementById("faceBox");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const resultScanAgainBtn = document.getElementById("resultScanAgainBtn");
const statusBadge = document.getElementById("statusBadge");
const cameraWrap = document.querySelector(".camera-wrap");

const emotionText = document.getElementById("emotionText");
const confidenceText = document.getElementById("confidenceText");
const quoteGreeting = document.getElementById("quoteGreeting");
const quoteText = document.getElementById("quoteText");
const topList = document.getElementById("topList");

const navButtons = document.querySelectorAll(".nav-btn");
const resultNavBtn = document.querySelector('.nav-btn[data-view="result"]');
const views = document.querySelectorAll(".view");
const contextPanels = document.querySelectorAll(".context-panel");
const historyBadge = document.getElementById("historyBadge");
const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const toast = document.getElementById("toast");

const feedbackForm = document.getElementById("feedbackForm");
const feedbackName = document.getElementById("feedbackName");
const feedbackRating = document.getElementById("feedbackRating");
const feedbackMessage = document.getElementById("feedbackMessage");
const feedbackSummary = document.getElementById("feedbackSummary");
const feedbackList = document.getElementById("feedbackList");
const clearFeedbackBtn = document.getElementById("clearFeedbackBtn");
const historyNoteParagraph = document.getElementById("historyNote");

// Refresh button
const refreshBtn = document.getElementById("refreshBtn");

// Support modal elements
const supportModal = document.getElementById("supportModal");
const closeSupportModal = document.getElementById("closeSupportModal");
const emotionSelect = document.getElementById("emotionSelect");
const quoteContainer = document.getElementById("quoteContainer");
const supportQuote = document.getElementById("supportQuote");
const thumbsUp = document.getElementById("thumbsUp");
const thumbsDown = document.getElementById("thumbsDown");

const HISTORY_KEY = "emotion_history_v1";
const FEEDBACK_KEY = "emotion_feedback_v1";
const UNSEEN_KEY = "emotion_unseen_history_v1";
const LAST_RESULT_KEY = "emotion_session_result_v1";
const MAX_HISTORY_ENTRIES = 20;
const CAPTURE_WIDTH = 640;
const REQUEST_TIMEOUT_MS = 25000;
const STABLE_FACE_FRAMES = 2;
const ANALYSIS_WAIT_MS = 5000;

let stream = null;
let inFlight = false;
let captureDelayTimer = null;
let toastTimer = null;
let currentView = "home";
let hasResult = false;
let detectRafId = null;
let detectLoopActive = false;
let lastDetectAt = 0;
let stableFaceCount = 0;
let autoCaptureTriggered = false;
let faceAnalysisStart = 0;

// Inject pulsing animation styles
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  .face-pulse { 
    animation: face-box-pulse 1.2s infinite ease-in-out; 
    border-color: #2ecc71 !important; 
    box-shadow: 0 0 20px rgba(46, 204, 113, 0.6);
  }
  .face-invalid { 
    border-color: #e74c3c !important; 
    box-shadow: none !important;
  }
  @keyframes face-box-pulse {
    0% { transform: translate(-50%, -50%) scale(1); }
    50% { transform: translate(-50%, -50%) scale(1.04); }
    100% { transform: translate(-50%, -50%) scale(1); }
  }
`;
document.head.appendChild(styleSheet);

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function setStatus(text, state) {
  statusBadge.textContent = text;
  statusBadge.classList.remove("idle", "running", "processing");
  statusBadge.classList.add(state);
}

function setResultNavEnabled(enabled) {
  if (!resultNavBtn) {
    return;
  }
  resultNavBtn.disabled = !enabled;
  resultNavBtn.setAttribute("aria-disabled", String(!enabled));
}

function setRunning(isRunning) {
  if (isRunning) {
    setStatus("Camera On", "running");
  } else {
    setStatus("Idle", "idle");
  }

  startBtn.disabled = isRunning || inFlight;
  stopBtn.disabled = !isRunning;
}

function getStoredArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function setStoredArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function trimHistoryEntries(history) {
  if (!Array.isArray(history) || history.length <= MAX_HISTORY_ENTRIES) {
    return { history, trimmed: false };
  }

  return {
    history: history.slice(0, MAX_HISTORY_ENTRIES),
    trimmed: true,
  };
}

function normalizeHistory() {
  const currentHistory = getStoredArray(HISTORY_KEY);
  const { history, trimmed } = trimHistoryEntries(currentHistory);

  if (trimmed) {
    setStoredArray(HISTORY_KEY, history);
  }

  return { history, trimmed };
}

function getUnseenCount() {
  const value = Number(localStorage.getItem(UNSEEN_KEY) || "0");
  return Number.isFinite(value) ? value : 0;
}

function setUnseenCount(value) {
  localStorage.setItem(UNSEEN_KEY, String(Math.max(0, value)));
}

function getHistoryCount() {
  return getStoredArray(HISTORY_KEY).length;
}

function updateHistoryBadge() {
  const unseen = getUnseenCount();
  const totalHistory = getHistoryCount();
  const count = unseen > 0 ? unseen : totalHistory;

  if (count > 0) {
    historyBadge.hidden = false;
    historyBadge.textContent = String(count);
  } else {
    historyBadge.hidden = true;
    historyBadge.textContent = "0";
  }
}

function renderHistoryNote(trimmed) {
  if (!historyNoteParagraph) {
    return;
  }

  if (trimmed) {
    historyNoteParagraph.textContent = "Your history was trimmed to keep the scan list fast and manageable. Only the latest 20 entries are saved.";
  } else {
    historyNoteParagraph.textContent = "Only the latest 20 scans are kept. Older entries are removed automatically when history grows too large.";
  }
}

function switchView(viewName) {
  if (viewName === "result" && !hasResult) {
    showToast("Run a scan first to view results.");
    return;
  }

  currentView = viewName;

  navButtons.forEach((button) => {
    const isActive = button.dataset.view === viewName;
    button.classList.toggle("active", isActive);
  });

  views.forEach((view) => {
    const isActive = view.id === `${viewName}View`;
    view.classList.toggle("active", isActive);
  });

  contextPanels.forEach((panel) => {
    const isActive = panel.dataset.context === viewName;
    panel.classList.toggle("active", isActive);
  });

  if (viewName === "history") {
    setUnseenCount(0);
    renderHistory();
    updateHistoryBadge();
  }

  if (viewName === "feedback") {
    renderFeedback();
  }
  
  // Re-trigger support modal timer if viewing an existing result
  if (viewName === "result" && hasResult) {
    if (window.supportModalTimer) clearTimeout(window.supportModalTimer);
    window.supportModalTimer = setTimeout(() => {
      if (currentView === "result") showSupportModal();
    }, 5000);
  }

  // Hide support modal when switching views
  hideSupportModal();
}

function renderResultCard(result) {
  emotionText.textContent = result.emotion;
  confidenceText.textContent = `Confidence: ${result.confidence}%`;
  quoteGreeting.innerHTML = `<span class="quote-salutation">Dear user,</span>`;
  quoteText.innerHTML = result.supportMessage || result.quote;

  topList.innerHTML = "";
  result.top_predictions.forEach((item) => {
    const container = document.createElement("div");
    container.className = "prediction-bar-container";
    container.innerHTML = `
      <div class="prediction-label">
        <span>${item.emotion}</span>
        <span>${item.confidence}%</span>
      </div>
      <div class="prediction-track">
        <div class="prediction-fill" style="width: ${item.confidence}%"></div>
      </div>
    `;
    topList.appendChild(container);
  });

  hasResult = true;
  setResultNavEnabled(true);
}

function getLeadLine(emotion) {
  // Match these exactly with the lowercase classes from main.py
  const leads = {
    angry: "It seems you're feeling a bit angry right now. Let's find some calm together,",
    disgust: "You're experiencing some disgust. It's okay to feel this way,",
    fear: "You seem a bit fearful right now. Remember, you're safe,",
    happy: "You feel happy right now! That's amazing,",
    neutral: "You're feeling calm and neutral right now. That's a steady place to be,",
    sad: "It looks like you're feeling a bit sad. I'm here to support you,",
    surprise: "You look quite surprised! Take a second to process that,",
  };

  return leads[emotion] || "I am here with you, one step at a time,";
}

function renderPrediction(data) {
  const lead = getLeadLine(data.emotion);
  const supportMessage = `<strong style="color: #6a11cb; font-style: italic;">${lead}</strong> ${data.quote}`;

  const resultPayload = {
    emotion: data.emotion,
    confidence: data.confidence,
    supportMessage,
    top_predictions: data.top_predictions,
  };

  sessionStorage.setItem(LAST_RESULT_KEY, JSON.stringify(resultPayload));
  renderResultCard(resultPayload);
  switchView("result");
}

function hideFaceBox() {
  if (!faceBox) {
    return;
  }
  faceBox.style.display = "none";
}

function stopFaceDetection() {
  if (window.captureTimer) {
    clearInterval(window.captureTimer);
    window.captureTimer = null;
  }
  if (window.alignmentCheckTimer) {
    clearInterval(window.alignmentCheckTimer);
    window.alignmentCheckTimer = null;
  }
  if (faceBox) {
    faceBox.classList.remove("aligned", "face-pulse", "face-invalid");
    faceBox.style.display = "none";
  }
  stableFaceCount = 0;
  autoCaptureTriggered = false;
}

function startFaceGuidanceAndCapture() {
  stopFaceDetection();
  if (faceBox) {
    faceBox.style.display = "block";
  }

  // Clear previous results from UI so user knows a new scan is happening
  emotionText.textContent = "Analyzing...";
  confidenceText.textContent = "Confidence: --%";
  topList.innerHTML = "<li>Processing new scan...</li>";
  hasResult = false;
  
  quoteGreeting.innerHTML = `<span class="quote-salutation">Dear user,</span>`;
  quoteText.textContent = "Position your face within the green box and stay still. Our AI is preparing to analyze your expression for the best results...";

  let countdown = 5;
  setStatus(`Analyzing in ${countdown}s...`, "running");

  // Real-time alignment check loop
  window.alignmentCheckTimer = setInterval(async () => {
    if (!stream || inFlight) return;

    // Create a small, low-res snapshot for the alignment check to save bandwidth
    const checkCanvas = document.createElement("canvas");
    checkCanvas.width = 320; 
    checkCanvas.height = 240;
    checkCanvas.getContext("2d").drawImage(video, 0, 0, 320, 240);
    const checkData = checkCanvas.toDataURL("image/jpeg", 0.5);

    try {
      const res = await fetch("/api/check-alignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: checkData })
      });
      const data = await res.json();

      if (data.aligned) {
        faceBox.classList.remove("face-invalid");
        faceBox.classList.add("face-pulse");
      } else {
        faceBox.classList.remove("face-pulse");
        faceBox.classList.add("face-invalid");
      }
    } catch (e) {
      console.error("Alignment check failed", e);
    }
  }, 800); // Check every 800ms

  window.captureTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      setStatus(`Analyzing in ${countdown}s...`, "running");
    } else {
      clearInterval(window.captureTimer);
      clearInterval(window.alignmentCheckTimer);
      window.captureTimer = null;
      window.alignmentCheckTimer = null;
      captureAndPredict();
    }
  }, 1000);
}

async function startCamera() {
  if (stream || inFlight) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    quoteText.textContent = "Camera is not supported in this browser.";
    showToast("Camera is not supported in this browser.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    video.srcObject = stream;
    setRunning(true);

    await new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      video.onloadedmetadata = () => resolve();
    });

    startFaceGuidanceAndCapture();
  } catch (err) {
    quoteText.textContent = "Camera access failed. Please allow camera permission and try again.";
    showToast("Camera access failed.");
    console.error(err);
  }
}

function stopCamera() {
  if (captureDelayTimer) {
    clearTimeout(captureDelayTimer);
    captureDelayTimer = null;
  }

  stopFaceDetection();
  hideFaceBox();
  cameraWrap.classList.remove("scanning");

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  video.srcObject = null;
  setRunning(false);
}

async function captureAndPredict() {
  if (!stream || !video.videoWidth || !video.videoHeight || inFlight) {
    return;
  }
  const clientStartTime = Date.now();
  const t0 = performance.now();

  stopFaceDetection();
  inFlight = true;
  startBtn.disabled = true;
  stopBtn.disabled = true;
  cameraWrap.classList.remove("scanning");
  cameraWrap.classList.add("processing");
  setStatus("Processing...", "processing");
  hideFaceBox();

  const captureHeight = Math.max(
    1,
    Math.round(CAPTURE_WIDTH * (video.videoHeight / video.videoWidth))
  );

  canvas.width = CAPTURE_WIDTH;
  canvas.height = captureHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frameData = canvas.toDataURL("image/jpeg", 0.9);
  const t1 = performance.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch("/api/predict", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({ 
        image: frameData,
        client_start_time: clientStartTime 
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();
    const t2 = performance.now();

    if (!response.ok) {
      throw new Error(data.detail || "Prediction failed.");
    }

    renderPrediction(data);
    const t3 = performance.now();

    console.log(`--- Detection-to-Feedback Latency ---`);
    console.log(`1. Image Prep/Base64: ${(t1 - t0).toFixed(2)}ms`);
    console.log(`2. Network + Server: ${(t2 - t1).toFixed(2)}ms (Server alone: ${data.backend_ms}ms)`);
    console.log(`3. UI Rendering: ${(t3 - t2).toFixed(2)}ms`);
    console.log(`TOTAL PIPELINE: ${(t3 - t0).toFixed(2)}ms`);
  } catch (err) {
    if (err.name === "AbortError") {
      quoteText.textContent = "Prediction timed out. Please try again.";
      showToast("Prediction timed out. Try again.");
    } else {
      // Display the specific error from the server (e.g., "No face detected")
      quoteText.textContent = err.message;
      showToast(err.message);
    }
    console.error(err);
  } finally {
    inFlight = false;
    cameraWrap.classList.remove("processing");
    stopCamera();
    startBtn.disabled = false;
  }
}

async function renderHistory() {
  try {
    const response = await fetch("/api/history");
    const history = await response.json();
    
    historyList.innerHTML = "";
    renderHistoryNote(history.length >= 20);

    if (history.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-note";
      empty.textContent = "No scans yet. Start camera and your results will appear here.";
      historyList.appendChild(empty);
      return;
    }

    history.forEach((entry) => {
      const card = document.createElement("article");
      card.className = "history-item";
      const time = new Date(entry.capturedAt).toLocaleString();
      
      const lead = getLeadLine(entry.emotion);
      const fullMessage = `<strong style="color: #6a11cb; font-style: italic;">${lead}</strong> ${entry.supportMessage}`;

      card.innerHTML = `
        <p class="history-time">${time}</p>
        <p class="history-emotion">${entry.emotion} <span>${entry.confidence}%</span></p>
        <p class="history-quote">${fullMessage}</p>
      `;
      historyList.appendChild(card);
    });
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

function renderFeedback() {
  const feedback = getStoredArray(FEEDBACK_KEY);
  feedbackSummary.innerHTML = "";
  feedbackList.innerHTML = "";

  if (feedback.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No feedback received yet. Your rating will appear in the app summary once submitted.";
    feedbackSummary.appendChild(empty);
    return;
  }

  const total = feedback.length;
  const ratings = [0, 0, 0, 0, 0, 0];
  feedback.forEach((item) => {
    const rating = Number(item.rating);
    if (rating >= 1 && rating <= 5) {
      ratings[rating] += 1;
    }
  });

  const totalText = document.createElement("p");
  totalText.className = "subtle";
  totalText.textContent = `Total ratings: ${total}. Feedback text is kept private.`;
  feedbackSummary.appendChild(totalText);

  const categories = [
    { rating: 5, label: "Excellent" },
    { rating: 4, label: "Good" },
    { rating: 3, label: "Fair" },
    { rating: 2, label: "Poor" },
    { rating: 1, label: "Very poor" },
  ];

  categories.forEach((category) => {
    const count = ratings[category.rating];
    const percent = total ? Math.round((count / total) * 100) : 0;

    const row = document.createElement("div");
    row.className = "feedback-category";
    row.innerHTML = `
      <div class="feedback-category-row">
        <span>${category.label}</span>
        <span>${percent}%</span>
      </div>
      <div class="feedback-category-bar">
        <div class="feedback-category-fill" style="width: ${percent}%;"></div>
      </div>
    `;

    feedbackSummary.appendChild(row);
  });
}

function submitFeedback(event) {
  event.preventDefault();

  const rating = feedbackRating.value;
  const message = feedbackMessage.value.trim();
  const name = feedbackName.value.trim();

  if (!rating || !message) {
    showToast("Please add a rating and message.");
    return;
  }

  const entries = getStoredArray(FEEDBACK_KEY);
  entries.unshift({
    name,
    rating,
    message,
    createdAt: new Date().toISOString(),
  });

  setStoredArray(FEEDBACK_KEY, entries.slice(0, 30));
  feedbackForm.reset();
  renderFeedback();
  showToast("Thank you. Your feedback was saved.");
}

function clearFeedback() {
  setStoredArray(FEEDBACK_KEY, []);
  renderFeedback();
  showToast("Feedback cleared.");
}

async function clearHistory() {
  try {
    const response = await fetch("/api/history/clear", { method: "POST" });
    if (!response.ok) throw new Error("Failed to clear server history");

    setUnseenCount(0);
    updateHistoryBadge();
    await renderHistory();
    showToast("History cleared successfully.");
  } catch (err) {
    console.error(err);
    showToast("Could not clear history. Please try again.");
  }
}

// Support modal functions
function showSupportModal() {
  if (!supportModal) return;
  supportModal.setAttribute("aria-hidden", "false");
  emotionSelect.value = "";
  quoteContainer.style.display = "none";
}

function hideSupportModal() {
  if (!supportModal) return;
  supportModal.setAttribute("aria-hidden", "true");
}

async function loadQuotesForEmotion(emotion) {
  try {
    const response = await fetch(`/api/quotes/${emotion}`);
    if (!response.ok) throw new Error("Failed to load quotes");
    const data = await response.json();
    return data.quotes;
  } catch (err) {
    console.error("Error loading quotes:", err);
    return [];
  }
}

function showRandomQuote(quotes) {
  if (quotes.length === 0) {
    supportQuote.innerHTML = `<span class="quote-salutation">Dear user,</span> I'm here for you. Take a deep breath.`;
    return;
  }
  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  supportQuote.innerHTML = `<span class="quote-salutation">Dear user,</span> ${randomQuote}`;
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
  button.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      switchView(button.dataset.view);
    }
  });
});

if (startBtn) {
  startBtn.addEventListener("click", startCamera);
}
if (stopBtn) {
  stopBtn.addEventListener("click", stopCamera);
}
if (resultScanAgainBtn) {
  resultScanAgainBtn.addEventListener("click", () => {
    switchView("scan");
    startCamera();
  });
}
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", clearHistory);
}
if (clearFeedbackBtn) {
  clearFeedbackBtn.addEventListener("click", clearFeedback);
}
if (feedbackForm) {
  feedbackForm.addEventListener("submit", submitFeedback);
}

// Refresh button
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    location.reload();
  });
  refreshBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      location.reload();
    }
  });
}

// Support modal event listeners
if (closeSupportModal) {
  closeSupportModal.addEventListener("click", hideSupportModal);
}
if (supportModal) {
  supportModal.addEventListener("click", (e) => {
    if (e.target === supportModal) hideSupportModal();
  });
}

if (emotionSelect && quoteContainer) {
  emotionSelect.addEventListener("change", async () => {
  const emotion = emotionSelect.value;
  if (!emotion) {
    quoteContainer.style.display = "none";
    return;
  }

  if (emotion === "satisfied") {
    // Show positive feedback and close modal
    showToast("Great! I'm glad the detection was accurate for you! 🌟");
    setTimeout(() => {
      hideSupportModal();
    }, 1500);
    return;
  }

  const quotes = await loadQuotesForEmotion(emotion);
  showRandomQuote(quotes);
  quoteContainer.style.display = "block";
  });
}

if (thumbsUp) {
  thumbsUp.addEventListener("click", () => {
  showToast("Thank you for the feedback! 😊");
  hideSupportModal();
  });
}

if (thumbsDown && emotionSelect) {
  thumbsDown.addEventListener("click", async () => {
  const emotion = emotionSelect.value;
  if (emotion) {
    const quotes = await loadQuotesForEmotion(emotion);
    showRandomQuote(quotes);
    showToast("Here's another supportive message.");
  }
  });
}

window.addEventListener("beforeunload", stopCamera);

updateHistoryBadge();
renderHistory();
renderFeedback();
setResultNavEnabled(false);

// Load the current session's result if the user is just switching tabs
// Initialize session state
(() => {
  try {
    const raw = sessionStorage.getItem(LAST_RESULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.emotion) renderResultCard(parsed);
    }
  } catch (e) {}
})();
