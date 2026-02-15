import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

if (import.meta.env.VITE_API_BASE) {
  window.API_BASE = import.meta.env.VITE_API_BASE;
}

if (import.meta.env.VITE_WS_BASE) {
  window.WS_BASE = import.meta.env.VITE_WS_BASE;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
