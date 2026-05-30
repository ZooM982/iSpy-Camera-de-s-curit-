# Start Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; python main.py"

# Start Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
