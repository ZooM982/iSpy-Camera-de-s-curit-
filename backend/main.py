import cv2
import numpy as np
import time
import threading
import os
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import base64
import logging

# Configure logging to a file to track activity when screen is off
logging.basicConfig(
    filename='recordings/activity.log',
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logging.info("--- iSpy System Started ---")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
camera = None
motion_detected = False
last_frame = None
recording = False
out = None

# Ensure recordings directory exists
if not os.path.exists("recordings"):
    os.makedirs("recordings")

class VideoCamera:
    def __init__(self):
        self.video = cv2.VideoCapture(0)
        # Set resolution to HD for wider field of view
        self.video.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        self.video.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        
        if not self.video.isOpened():
            print("Error: Could not open camera.")
        self.reference_frame = None
        self.motion_detected = False
        self.recording = False
        self.out = None
        self.last_motion_time = 0
        self.recording_start_time = 0
        self.is_active = True 
        self.reference_frame = None
        self.frame_count = 0
        self.last_log_time = time.time()
        
        # Initialize CLAHE for better low-light contrast
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        
        # Initialize HOG for Human AI detection
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

        # Background thread variables
        self.latest_frame_b64 = None
        self.latest_motion = False
        self.latest_timestamp = datetime.now().isoformat()

    def toggle(self, status: bool):
        self.is_active = status
        if not status:
            self.stop_recording()
        print(f"System status: {'Active' if status else 'Inactive'}")

    def __del__(self):
        self.video.release()

    def get_frame(self):
        if not self.is_active:
            img = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(img, "System Standby", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (100, 100, 100), 2)
            return img, False

        if not self.video.isOpened():
            # Create a black frame with text
            img = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(img, "Camera Not Found", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            return img, False

        success, image = self.video.read()
        
        # Heartbeat log every 60 seconds
        if time.time() - self.last_log_time > 60:
            status = "Recording" if self.recording else "Monitoring"
            logging.info(f"System Heartbeat: {status}, Camera Connected: {success}")
            self.last_log_time = time.time()

        if not success:
            logging.warning("Failed to read from camera. Attempting reconnection...")
            self.video.release()
            time.sleep(2)
            self.video = cv2.VideoCapture(0)
            return None, False

        self.frame_count += 1

        # Keep a copy of the clean image before drawing bounding boxes
        clean_image = image.copy()

        # 0. Enhance image for low light
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = self.clahe.apply(gray) # Apply contrast enhancement
        gray = cv2.GaussianBlur(gray, (21, 21), 0)

        if self.reference_frame is None:
            self.reference_frame = gray.copy().astype("float")
            return image, False

        # 1. General Motion detection (Frame Differencing)
        # Slow down accumulation (0.02) to avoid "forgetting" motion
        cv2.accumulateWeighted(gray, self.reference_frame, 0.02)
        frame_delta = cv2.absdiff(gray, cv2.convertScaleAbs(self.reference_frame))
        thresh = cv2.threshold(frame_delta, 15, 255, cv2.THRESH_BINARY)[1] # More sensitive (15 instead of 20)
        thresh = cv2.dilate(thresh, None, iterations=2)
        contours, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        motion_found = False
        for contour in contours:
            if cv2.contourArea(contour) > 200: # Smaller objects detected (200 instead of 500)
                motion_found = True
                (x, y, w, h) = cv2.boundingRect(contour)
                cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 1) # Thin green line for general motion

        # 2. Human AI detection (HOG)
        # Resize even more for performance (0.3 instead of 0.5)
        small_frame = cv2.resize(image, (0, 0), fx=0.3, fy=0.3)
        (rects, weights) = self.hog.detectMultiScale(small_frame, winStride=(8, 8), padding=(8, 8), scale=1.05)
        
        human_found = len(rects) > 0
        if human_found:
            for (x, y, w, h) in rects:
                # Scale coordinates back up (1/0.3 = ~3.33)
                x, y, w, h = int(x/0.3), int(y/0.3), int(w/0.3), int(h/0.3)
                cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 2)
                cv2.putText(image, "Human Detected", (x, y-10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        # Hybrid Decision: Record if EITHER is true
        self.motion_detected = motion_found or human_found

        # Handle Recording
        if self.motion_detected:
            self.last_motion_time = time.time()
            if not self.recording:
                self.start_recording()
        
        if self.recording and time.time() - self.last_motion_time > 30: # Wait 30s of no-person before stopping
            self.stop_recording()

        # Handle Recording Splitting (5 min limit)
        if self.recording and (time.time() - self.recording_start_time > 300):
            print("File limit reached (5 min). Splitting recording...")
            self.stop_recording()
            if self.motion_detected:
                self.start_recording()

        if self.recording and self.out:
            self.out.write(clean_image)

        return image, self.motion_detected

    def start_recording(self):
        self.recording = True
        self.recording_start_time = time.time() # Reset start time
        filename = f"recordings/motion_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.out = cv2.VideoWriter(filename, fourcc, 15.0, (1280, 720))
        logging.info(f"STARTED RECORDING: {filename}")
        print(f"Started recording: {filename}")

    def stop_recording(self):
        self.recording = False
        if self.out:
            self.out.release()
            self.out = None
        logging.info("STOPPED RECORDING")
        print("Stopped recording")

    def update_loop(self):
        print("Camera background loop started")
        logging.info("Camera background loop started")
        while True:
            try:
                frame, motion = self.get_frame()
                if frame is not None:
                    _, buffer = cv2.imencode('.jpg', frame)
                    jpg_as_text = base64.b64encode(buffer).decode('utf-8')
                    self.latest_frame_b64 = jpg_as_text
                    self.latest_motion = motion
                    self.latest_timestamp = datetime.now().isoformat()
                else:
                    self.latest_frame_b64 = None
                    self.latest_motion = False
                    self.latest_timestamp = datetime.now().isoformat()
            except Exception as e:
                print(f"Error in camera background loop: {e}")
                logging.error(f"Error in camera background loop: {e}")
            time.sleep(0.05) # ~20 FPS

video_camera = VideoCamera()

# Start background camera loop thread
camera_thread = threading.Thread(target=video_camera.update_loop, daemon=True)
camera_thread.start()

@app.get("/")
def read_root():
    return {"message": "iSpy Backend Running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Check for messages from client (non-blocking)
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=0.01)
                if data.get("command") == "toggle":
                    video_camera.toggle(data.get("value"))
            except asyncio.TimeoutError:
                pass

            if video_camera.latest_frame_b64 is not None:
                await websocket.send_json({
                    "image": video_camera.latest_frame_b64,
                    "motion": video_camera.latest_motion,
                    "timestamp": video_camera.latest_timestamp,
                    "active": video_camera.is_active
                })
            
            await asyncio.sleep(0.05) # ~20 FPS
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6005)
