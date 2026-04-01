import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const StockAnalysis: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dash');
  const [valuation] = useState(0);

  return (
    <div className="premium-container" style={{ padding: '0', maxWidth: '1200px' }}>
      <header style={{ background: '#d4af37', color: '#fff', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800 }}>📉 Stock Analysis</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
           <button className="btn-gold" style={{ background: 'rgba(255,255,255,0.2)', padding: '5px 12px' }}>Inventory</button>
           <button className="btn-gold" style={{ background: 'rgba(255,255,255,0.4)', padding: '5px 12px' }}>Reports</button>
        </div>
      </header>
      
      <nav style={{ background: '#fff', borderBottom: '1px solid #eee', display: 'flex', padding: '0 16px' }}>
        {['dash', 'stock', 'sell', 'exp'].map(tab => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              color: activeTab === tab ? 'var(--primary-dark)' : '#6b7280',
              borderBottom: activeTab === tab ? '3px solid var(--primary-dark)' : '3px solid transparent'
            }}
          >
            {tab.toUpperCase()}
          </button>
        ))}
      </nav>

      <main style={{ padding: '24px' }}>
        {activeTab === 'dash' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div className="portal-card" style={{ padding: '20px', alignItems: 'flex-start', textAlign: 'left' }}>
              <div style={{ color: 'var(--primary-dark)', fontWeight: 800 }}>TOTAL VALUATION</div>
              <div style={{ fontSize: '32px', fontWeight: 900, marginTop: '10px' }}>৳ {valuation.toLocaleString()}</div>
              <p style={{ fontSize: '12px', color: '#888', marginTop: '5px' }}>Total stock value in inventory</p>
            </div>
            
            <div className="portal-card" style={{ padding: '20px', alignItems: 'flex-start', textAlign: 'left' }}>
               <div style={{ color: 'green', fontWeight: 800 }}>TOTAL SALES (TODAY)</div>
               <div style={{ fontSize: '32px', fontWeight: 900, marginTop: '10px' }}>৳ 0</div>
               <p style={{ fontSize: '12px', color: '#888', marginTop: '5px' }}>Based on 0 entries</p>
            </div>
          </div>
        )}

        {/* Other tabs placeholders */}
        {activeTab !== 'dash' && (
          <div style={{ background: 'white', padding: '40px', borderRadius: '32px', textAlign: 'center', boxShadow: 'var(--shadow-soft)' }}>
            <h3>Migration in Progress...</h3>
            <p style={{ color: '#aaa' }}>The {activeTab} logic is being integrated from the legacy system.</p>
          </div>
        )}
      </main>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
         <Link to="/" style={{ color: 'var(--primary-dark)', fontWeight: 600, textDecoration: 'none' }}>← Return to Portal</Link>
      </div>
    </div>
  );
};

export default StockAnalysis;
