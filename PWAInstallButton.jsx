import { useState, useEffect } from 'react';

export default function PWAInstallButton() {
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.isPWA()) {
      setInstalled(true);
      return;
    }

    // Listen for install availability
    const handleInstallAvailable = () => {
      setInstallable(true);
    };

    window.addEventListener('pwa-install-available', handleInstallAvailable);

    // Check if prompt is already available
    if (window.deferredPrompt) {
      setInstallable(true);
    }

    return () => {
      window.removeEventListener('pwa-install-available', handleInstallAvailable);
    };
  }, []);

  const handleInstall = () => {
    if (window.showPWAInstall) {
      window.showPWAInstall();
      setInstallable(false);
    }
  };

  // Don't show if already installed
  if (installed) {
    return null;
  }

  // Don't show if not installable
  if (!installable) {
    return null;
  }

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
          </svg>
        </div>
        <div className="pwa-install-text">
          <h3>Installeer Hike5</h3>
          <p>Gebruik Hike5 als native app - ook offline!</p>
        </div>
        <button onClick={handleInstall} className="pwa-install-button">
          Installeer
        </button>
      </div>
    </div>
  );
}

// CSS voor install banner (voeg toe aan style.css)
/*
.pwa-install-banner {
  position: fixed;
  bottom: 20px;
  left: 20px;
  right: 20px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 4px 20px rgba(34, 197, 94, 0.3);
  z-index: 1000;
  animation: slideUp 0.3s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(100px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.pwa-install-content {
  display: flex;
  align-items: center;
  gap: 16px;
  color: white;
}

.pwa-install-icon {
  flex-shrink: 0;
}

.pwa-install-text {
  flex: 1;
}

.pwa-install-text h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
}

.pwa-install-text p {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
}

.pwa-install-button {
  background: white;
  color: #16a34a;
  border: none;
  padding: 10px 24px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.pwa-install-button:hover {
  transform: scale(1.05);
}

.pwa-install-button:active {
  transform: scale(0.95);
}

@media (max-width: 640px) {
  .pwa-install-banner {
    bottom: 10px;
    left: 10px;
    right: 10px;
  }
  
  .pwa-install-content {
    flex-direction: column;
    text-align: center;
    gap: 12px;
  }
  
  .pwa-install-button {
    width: 100%;
  }
}
*/
