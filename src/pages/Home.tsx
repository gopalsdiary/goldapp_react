import React from 'react';
// import { Link } from 'react-router-dom'; (Unused)

const Home: React.FC = () => {
  return (
    <div className="premium-container">
      <header className="header-section" style={{ textAlign: 'center', marginBottom: '50px' }}>
        <h1 style={{ fontSize: '3.5rem', fontWeight: 850, letterSpacing: '-2px', textTransform: 'uppercase' }}>
          Goldsmith<span className="brand-accent">.</span>
        </h1>
        <p style={{ fontSize: '1.15rem', color: 'var(--text-dim)', letterSpacing: '1px', fontWeight: 500 }}>
          LUXURY & ELEGANCE REDEFINED
        </p>
      </header>

      <div className="portal-grid">
        <a 
          href="/admin/admin_dashboard.html" 
          className="portal-card"
          onClick={(e) => {
            e.preventDefault();
            const pwd = prompt("Enter Admin Password:");
            if (pwd === '11223') {
              window.location.href = e.currentTarget.href;
            } else if (pwd !== null) {
              alert("Access Denied: Incorrect password.");
            }
          }}
        >
          <div className="card-icon">
            <span className="material-icons">business_center</span>
          </div>
          <div className="card-content">
            <div className="card-title">Admin Console</div>
            <div className="card-desc">Backend management for inventory and sales data.</div>
          </div>
        </a>
      </div>

      <footer className="footer-note" style={{ textAlign: 'center', marginTop: '60px', color: '#aaa' }}>
        &copy; 2026 Goldsmith Portal. Crafted for <span style={{ color: 'var(--primary-dark)' }}>Excellence</span>.
      </footer>
    </div>
  );
};

export default Home;
