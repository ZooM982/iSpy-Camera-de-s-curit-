import { useState, useEffect, useRef } from 'react';
import { Shield, Radio, Play, Pause } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [frame, setFrame] = useState(null);
  const [isMotion, setIsMotion] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [timestamp, setTimestamp] = useState('');
  const ws = useRef(null);

  function toggleCamera() {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        command: 'toggle',
        value: !isActive
      }));
    }
  }

  function connectWS() {
    const defaultUrl = `ws://${window.location.hostname}:6005/ws`;
    const wsUrl = import.meta.env.VITE_WS_URL || defaultUrl;
    ws.current = new WebSocket(wsUrl);
    
    ws.current.onopen = () => {
      console.log('Connected to iSpy Backend');
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setFrame(`data:image/jpeg;base64,${data.image}`);
      setIsMotion(data.motion);

      if (data.active !== undefined) {
        setIsActive(data.active);
      }
      
      setTimestamp(new Date(data.timestamp).toLocaleTimeString());
    };

    ws.current.onclose = () => {
      setTimeout(connectWS, 3000);
    };
  }

  useEffect(() => {
    connectWS();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  return (
    <div className="app-container">
      <header>
        <div className="logo">
          <Shield className="logo-icon" size={32} />
          <span>iSpy AI</span>
        </div>
      </header>

      <main className="main-layout">
        <section className="video-section">
          {frame ? (
            <img src={frame} alt="Stream" className="video-stream" />
          ) : (
            <div className="flex flex-col items-center gap-4 text-slate-500">
              <Radio className="animate-pulse" size={48} />
              <p>Waiting for camera feed...</p>
            </div>
          )}
          
          <div className="video-overlay">
            <div className="overlay-top">
              <div className="timestamp">{timestamp}</div>
              <AnimatePresence>
                {isMotion && (
                  <motion.div 
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                    className="bg-red-600 text-white px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1"
                  >
                    <div className="w-2 h-2 bg-white rounded-full"></div>
                    REC
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="overlay-controls flex gap-3">
            <button 
              className="btn-icon" 
              onClick={toggleCamera} 
              title={isActive ? "Pause Monitoring" : "Resume Monitoring"}
            >
              {isActive ? <Pause size={20} /> : <Play size={20} />}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
