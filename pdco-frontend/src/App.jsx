import './App.css';

const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

function App() {
  return (
    <main className="app-shell">
      <h1>PDCo Dev Studio</h1>
      <p>React + Vite pipeline is configured and ready.</p>
      <p>
        API base URL: <code>{apiUrl}</code>
      </p>
    </main>
  );
}

export default App;
