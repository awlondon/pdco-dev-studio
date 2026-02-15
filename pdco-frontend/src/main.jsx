window.API_BASE = import.meta.env.VITE_API_BASE;
window.WS_BASE = import.meta.env.VITE_WS_BASE;

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
