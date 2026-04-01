import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const LoanManager: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dash');
  const [stats, setStats] = useState({
    active: 0,
    outstandingAsol: 0,
    outstandingMunafa: 0,
    totalCollected: 0,
    closedLoans: 0
  });

  useEffect(() => {
    // Initial data fetch would go here
    const fetchStats = async () => {
      // Simplification of statistics fetching logic
      console.log("Fetching loan stats...");
    };
    fetchStats();
  }, []);

  return (
    <div className="premium-container" style={{ padding: '0', maxWidth: '1000px' }}>
      <header style={{ background: '#d97706', color: '#fff', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>💰 Loan Manager</h1>
        <button className="btn-gold" style={{ padding: '6px 12px', fontSize: '12px' }}>🖨️ Report</button>
      </header>

      <nav style={{ background: '#fff', borderBottom: '1px solid #eee', display: 'flex' }}>
        {['dash', 'all', 'new'].map(tab => (
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
              color: activeTab === tab ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === tab ? '3px solid #2563eb' : '3px solid transparent'
            }}
          >
            {tab === 'dash' ? '📊 Dashboard' : tab === 'all' ? '📋 All Loans' : '➕ New Loan'}
          </button>
        ))}
      </nav>

      <main style={{ padding: '20px' }}>
        {activeTab === 'dash' && (
          <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div className="sc s1" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #059669', boxShadow: 'var(--shadow-soft)' }}>
              <div style={{ fontSize: '10px', color: '#666' }}>ACTIVE LOANS</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669' }}>{stats.active}</div>
            </div>
            <div className="sc s3" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #dc2626', boxShadow: 'var(--shadow-soft)' }}>
              <div style={{ fontSize: '10px', color: '#666' }}>OUTSTANDING</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#dc2626' }}>{stats.outstandingAsol}</div>
            </div>
            {/* Add more cards similar to the original */}
          </div>
        )}

        {activeTab === 'all' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: 'var(--shadow-soft)' }}>
            <h3>📋 Loan Records</h3>
            {/* Placeholder for list */}
            <p style={{ color: '#aaa', marginTop: '20px' }}>Loading loan data...</p>
          </div>
        )}

        {activeTab === 'new' && (
          <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: 'var(--shadow-soft)' }}>
            <h3>➕ Add New Loan</h3>
            {/* Form similar to the original */}
            <p style={{ color: '#aaa', marginTop: '20px' }}>Loan creation form is being migrated...</p>
          </div>
        )}
      </main>

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>← Back to Portal</Link>
      </div>
    </div>
  );
};

export default LoanManager;
