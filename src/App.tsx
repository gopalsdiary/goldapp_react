import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Loan from './pages/Loan';
import Stock from './pages/Stock';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app-shell">
        <div className="bg-layer"></div>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/loan" element={<Loan />} />
          <Route path="/stock" element={<Stock />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
