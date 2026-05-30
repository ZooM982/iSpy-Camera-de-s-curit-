import { useState, useEffect, useRef } from 'react';
import { Shield, Radio, Play, Pause, Film, Sliders, Trash2, Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [frame, setFrame] = useState(null);
  const [isMotion, setIsMotion] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [timestamp, setTimestamp] = useState('');
  
  // Settings & Config
  const [threshold, setThreshold] = useState(15);
  const [minArea, setMinArea] = useState(200);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  
  // Gallery & Video states
  const [recordings, setRecordings] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);

  const ws = useRef(null);

  // Compute HTTP API base URL from WS URL
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.');
  const defaultUrl = `ws://${isLocal ? window.location.hostname : 'localhost'}:6005/ws`;
  const rawWsUrl = isLocal ? defaultUrl : (import.meta.env.VITE_WS_URL || defaultUrl);
  // Ensure wsUrl starts with ws:// or wss:// even if input is http:// or https://
  const wsUrl = rawWsUrl.replace(/^http/, 'ws');
  const apiBaseUrl = wsUrl.replace(/^ws/, 'http').replace(/\/ws$/, '');

  function toggleCamera() {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        command: 'toggle',
        value: !isActive
      }));
    }
  }

  function sendConfig(newThreshold, newMinArea, newCameraIndex) {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        command: 'update_config',
        threshold: newThreshold,
        min_area: newMinArea,
        camera_index: newCameraIndex
      }));
    }
  }

  function handleThresholdChange(e) {
    const val = parseInt(e.target.value);
    setThreshold(val);
    sendConfig(val, minArea, cameraIndex);
  }

  function handleMinAreaChange(e) {
    const val = parseInt(e.target.value);
    setMinArea(val);
    sendConfig(threshold, val, cameraIndex);
  }

  function handleCameraIndexChange(e) {
    const val = parseInt(e.target.value);
    setCameraIndex(val);
    sendConfig(threshold, minArea, val);
  }

  async function fetchRecordings() {
    setIsLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/recordings`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (response.ok) {
        const data = await response.json();
        setRecordings(data);
      }
    } catch (error) {
      console.error("Error fetching recordings:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function deleteRecording(filename) {
    if (!window.confirm("Voulez-vous vraiment supprimer cet enregistrement ?")) return;
    try {
      const response = await fetch(`${apiBaseUrl}/api/recordings/${filename}`, {
        method: 'DELETE',
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (response.ok) {
        setRecordings(prev => prev.filter(r => r.id !== filename));
        if (activeVideo === filename) {
          setActiveVideo(null);
        }
      }
    } catch (error) {
      console.error("Error deleting recording:", error);
    }
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function connectWS() {
    const wsTarget = wsUrl.endsWith('/ws') ? wsUrl : `${wsUrl}/ws`;
    ws.current = new WebSocket(wsTarget);
    
    ws.current.onopen = () => {
      console.log('Connected to iSpy Backend');
      setIsWsConnected(true);
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setFrame(`data:image/jpeg;base64,${data.image}`);
      setIsMotion(data.motion);

      if (data.active !== undefined) {
        setIsActive(data.active);
      }
      if (data.threshold !== undefined) {
        setThreshold(data.threshold);
      }
      if (data.min_area !== undefined) {
        setMinArea(data.min_area);
      }
      if (data.camera_index !== undefined) {
        setCameraIndex(data.camera_index);
      }
      
      setTimestamp(new Date(data.timestamp).toLocaleTimeString());
    };

    ws.current.onclose = () => {
      setIsWsConnected(false);
      setTimeout(connectWS, 3000);
    };
  }

  useEffect(() => {
    connectWS();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  useEffect(() => {
    if (showGallery) {
      fetchRecordings();
    }
  }, [showGallery]);

  return (
    <div className="app-container">
      <header>
        <div className="logo">
          <img src="/logo.svg" alt="iSpy AI" className="logo-img" style={{ width: '32px', height: '32px' }} />
          <span>iSpy AI</span>
        </div>
        <div className="header-status">
          {!isWsConnected ? (
            <div className="status-badge disconnected">
              <span className="status-dot disconnected"></span>
              <span>DÉCONNECTÉ</span>
            </div>
          ) : (
            <div className={`status-badge ${isActive ? 'active' : ''}`}>
              <span className={`status-dot ${isActive ? (isMotion ? 'recording' : 'active') : ''}`}></span>
              <span>{isActive ? (isMotion ? "ENREGISTREMENT" : "SURVEILLANCE") : "VEILLE"}</span>
            </div>
          )}
        </div>
      </header>

      <main className="main-layout">
        <section className="video-section">
          {frame ? (
            <img src={frame} alt="Stream" className="video-stream" />
          ) : (
            <div className="flex flex-col items-center gap-4 text-slate-500">
              <Radio className="animate-pulse" size={48} />
              <p>Connexion à la caméra...</p>
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
              className={`btn-icon ${showSettings ? 'active-btn' : ''}`}
              onClick={() => setShowSettings(prev => !prev)}
              title="Réglages de détection"
            >
              <Sliders size={20} />
            </button>
            
            <button 
              className={`btn-icon ${showGallery ? 'active-btn' : ''}`}
              onClick={() => setShowGallery(prev => !prev)}
              title="Galerie d'enregistrements"
            >
              <Film size={20} />
            </button>

            <button 
              className="btn-icon" 
              onClick={toggleCamera} 
              title={isActive ? "Mettre en veille" : "Activer la surveillance"}
            >
              {isActive ? <Pause size={20} /> : <Play size={20} />}
            </button>
          </div>
        </section>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="settings-panel panel pointer-events-auto"
            >
              <div className="panel-header">
                <h3><Sliders size={18} /> Réglages Détection</h3>
                <button className="btn-close" onClick={() => setShowSettings(false)}><X size={18} /></button>
              </div>
              
              <div className="setting-item">
                <div className="setting-label">
                  <span>Seuil de Mouvement : {threshold}</span>
                  <span className="info-txt">Plus bas = plus sensible</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="50" 
                  value={threshold} 
                  onChange={handleThresholdChange}
                />
              </div>

              <div className="setting-item">
                <div className="setting-label">
                  <span>Taille Zone Min (px) : {minArea}</span>
                  <span className="info-txt">Plus bas = petits objets détectés</span>
                </div>
                <input 
                  type="range" 
                  min="50" 
                  max="2000" 
                  step="50"
                  value={minArea} 
                  onChange={handleMinAreaChange}
                />
              </div>

              <div className="setting-item">
                <div className="setting-label">
                  <span>Index de la Caméra : {cameraIndex}</span>
                  <span className="info-txt">Sélectionnez le périphérique vidéo</span>
                </div>
                <select 
                  value={cameraIndex} 
                  onChange={handleCameraIndexChange}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    marginTop: '0.25rem',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'inherit',
                    fontSize: '0.875rem'
                  }}
                >
                  <option value={0} style={{ background: '#0f172a', color: '#fff' }}>Caméra par défaut (0)</option>
                  <option value={1} style={{ background: '#0f172a', color: '#fff' }}>Caméra secondaire (1)</option>
                  <option value={2} style={{ background: '#0f172a', color: '#fff' }}>Autre caméra (2)</option>
                  <option value={3} style={{ background: '#0f172a', color: '#fff' }}>Autre caméra (3)</option>
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Gallery Drawer */}
        <AnimatePresence>
          {showGallery && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="gallery-panel panel pointer-events-auto"
            >
              <div className="panel-header">
                <h3><Film size={18} /> Enregistrements</h3>
                <button className="btn-close" onClick={() => setShowGallery(false)}><X size={18} /></button>
              </div>

              <div className="event-list">
                {isLoading ? (
                  <p className="loading-txt">Chargement...</p>
                ) : recordings.length === 0 ? (
                  <p className="empty-txt">Aucun enregistrement vidéo</p>
                ) : (
                  recordings.map((video) => (
                    <div key={video.id} className="event-card">
                      <div className="event-thumbnail" onClick={() => setActiveVideo(video.id)}>
                        <img 
                          src={`${apiBaseUrl}/api/recordings/thumbnail/${video.id}`} 
                          alt="Miniature" 
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = '/logo.svg';
                          }}
                        />
                      </div>
                      <div className="event-details" onClick={() => setActiveVideo(video.id)}>
                        <span className="video-filename" title={video.name}>{video.name}</span>
                        <h4>{formatDate(video.date)}</h4>
                        <p>{formatSize(video.size)}</p>
                      </div>
                      <div className="card-actions">
                        <a 
                          href={`${apiBaseUrl}/api/recordings/play/${video.id}`} 
                          download 
                          className="btn-action-icon"
                          title="Télécharger"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download size={16} />
                        </a>
                        <button 
                          className="btn-action-icon btn-delete"
                          title="Supprimer"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteRecording(video.id);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Video Player Modal */}
        <AnimatePresence>
          {activeVideo && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="modal-backdrop pointer-events-auto"
            >
              <motion.div 
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                className="player-modal"
              >
                <div className="modal-header">
                  <span>Lecture : {activeVideo}</span>
                  <button className="btn-close" onClick={() => setActiveVideo(null)}><X size={20} /></button>
                </div>
                <div className="video-player-container">
                  <video 
                    src={`${apiBaseUrl}/api/recordings/play/${activeVideo}`} 
                    controls 
                    autoPlay 
                    className="modal-video"
                  />
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
