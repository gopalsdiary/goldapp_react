import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { 
  Loan, 
  Transaction, 
  LoanBalance,
  HistoryEntry
} from '../lib/loanUtils';
import { 
  getLoanBalance, 
  tk, 
  fmtDate,
  renderLoanStatement
} from '../lib/loanUtils';

const LoanManager: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('dash');
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);
  const [loanInfo, setLoanInfo] = useState<LoanBalance | null>(null);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  // Responsive logic
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  
  const [stats, setStats] = useState({
    active: 0,
    disbursed: 0,
    outstandingAsol: 0,
    outstandingMunafa: 0,
    totalCollected: 0,
    totalCollAsol: 0,
    totalCollMunafa: 0,
    closedLoans: 0,
    badDebtCount: 0,
    badDebtAmount: 0
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'closed'>('all');
  
  const [showPayModal, setShowPayModal] = useState(false);
  const [payMode, setPayMode] = useState<'normal' | 'principal' | 'interest' | 'adj'>('normal');

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: loansData } = await supabase.from('loans').select('*');
      const { data: txnsData } = await supabase
        .from('loan_transactions')
        .select('*')
        .order('txn_date', { ascending: true })
        .order('created_at', { ascending: true });

      const lData = (loansData as Loan[]) || [];
      const tData = (txnsData as Transaction[]) || [];
      setLoans(lData);
      setTransactions(tData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    const iidParam = searchParams.get('iid');
    if (iidParam && loans.length > 0) {
      const found = loans.find(l => l.iid === parseInt(iidParam));
      if (found && (!selectedLoan || selectedLoan.id !== found.id)) {
        loadAccount(found);
      }
    } else if (!iidParam && activeTab === 'acct') {
      setActiveTab('dash');
      setSelectedLoan(null);
      setLoanInfo(null);
    }
  }, [searchParams, loans]);

  const loadAccount = async (loan: Loan) => {
    setLoading(true);
    const loanTxns = transactions.filter(t => t.loan_id === loan.id);
    const info = await getLoanBalance(loan, null, null, loanTxns);
    setSelectedLoan(loan);
    setLoanInfo(info);
    setActiveTab('acct');
    setLoading(false);
  };

  const openAccount = (id: string) => {
    const loan = loans.find(l => l.id === id);
    if (loan) {
      setSearchParams({ iid: loan.iid.toString() });
    }
  };

  useEffect(() => {
    const calculateStats = async () => {
      if (loans.length === 0) return;

      let active = 0;
      let disbursed = 0;
      let outAsol = 0;
      let outMunafa = 0;
      let closed = 0;
      let badCount = 0;
      let badAmt = 0;

      const results = await Promise.all(
        loans.map((loan) => {
          const loanTxns = transactions.filter((t) => t.loan_id === loan.id);
          return getLoanBalance(loan, null, null, loanTxns);
        })
      );

      results.forEach((info: LoanBalance, idx: number) => {
        const loan = loans[idx];
        if (loan.status === 'active') {
          active++;
          disbursed += parseFloat(loan.loan_amount as any);
          outAsol += info.principal;
          outMunafa += info.interest_owed;
        } else {
          closed++;
          if (info.preClosureDue > 1) {
            badCount++;
            badAmt += info.preClosureDue;
          }
        }
      });

      let collAsol = 0;
      let collMunafa = 0;
      transactions.forEach((txn) => {
        const amount = parseFloat(txn.amount as any);
        if (amount > 0) {
          if (txn.remarks?.includes('আসল')) {
            collAsol += amount;
          } else {
            collMunafa += amount;
          }
        }
      });

      setStats({
        active,
        disbursed,
        outstandingAsol: outAsol,
        outstandingMunafa: outMunafa,
        totalCollected: collAsol + collMunafa,
        totalCollAsol: collAsol,
        totalCollMunafa: collMunafa,
        closedLoans: closed,
        badDebtCount: badCount,
        badDebtAmount: badAmt
      });
    };

    calculateStats();
  }, [loans, transactions]);

  const handlePayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLoan) return;
    setLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const date = formData.get('date') as string;
    let remarks = formData.get('remarks') as string || '';

    if (payMode === 'principal') remarks = '(আসল জমা) ' + remarks;
    else if (payMode === 'interest') remarks = '(মুনাফা জমা) ' + remarks;
    else if (payMode === 'adj') remarks = 'ভুল সংশোধন (Adjustment): ' + remarks;

    try {
      const { error } = await supabase.from('loan_transactions').insert([{
        loan_id: selectedLoan.id,
        amount: payMode === 'adj' ? -amount : amount,
        txn_date: date,
        remarks: remarks || (amount > 0 ? 'জমা' : 'অতিরিক্ত লোন প্রদান')
      }]);

      if (error) throw error;
      setShowPayModal(false);
      await fetchData();
      if (selectedLoan) {
        const freshLoan = loans.find(l => l.id === selectedLoan.id) || selectedLoan;
        loadAccount(freshLoan);
      }
    } catch (error) {
      alert('Error saving payment');
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!selectedLoan || !loanInfo) return;
    const htmlString = renderLoanStatement(selectedLoan, loanInfo);
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    tempDiv.style.width = '794px';
    tempDiv.style.background = '#fff';
    
    const opt = {
      margin: 10,
      filename: `Statement_${selectedLoan.iid}_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    
    if ((window as any).html2pdf) {
      (window as any).html2pdf().set(opt).from(tempDiv).save();
    } else {
      alert("PDF library not loaded yet. Please try again.");
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLoan) return;
    setLoading(true);
    
    const formData = new FormData(e.currentTarget);
    const updates: Record<string, any> = {
      name: formData.get('name')?.toString() || '',
      mobile: formData.get('mobile')?.toString() || '',
      nid_number: formData.get('nid_number')?.toString() || '',
      loan_date: formData.get('loan_date')?.toString() || '',
      loan_amount: parseFloat(formData.get('loan_amount')?.toString() || '0'),
      interest_rate: parseFloat(formData.get('interest_rate')?.toString() || '0'),
      loan_months: parseInt(formData.get('loan_months')?.toString() || '0', 10),
      deposit_item: formData.get('deposit_item')?.toString() || '',
      remarks: formData.get('remarks')?.toString() || '',
      status: formData.get('status')?.toString() || 'active',
    };

    if (updates.status === 'closed' && selectedLoan.status !== 'closed') {
      updates.closed_at = new Date().toISOString();
    } else if (updates.status !== 'closed') {
      updates.closed_at = null;
    }

    try {
      const oldRate = selectedLoan.interest_rate;
      if (updates.interest_rate !== oldRate) {
        await supabase.from('loan_transactions').insert([{
          loan_id: selectedLoan.id,
          txn_date: new Date().toISOString().split('T')[0],
          amount: 0,
          txn_type: 'adjustment',
          remarks: `🔄 হার পরিবর্তন: ${oldRate}% -> ${updates.interest_rate}%`
        }]);
      }

      const { error } = await supabase.from('loans').update(updates).eq('id', selectedLoan.id);
      if (error) throw error;
      
      setIsEditingProfile(false);
      await fetchData();
      alert('তথ্য সফলভাবে আপডেট করা হয়েছে!');
      
      const updatedLoan = { ...selectedLoan, ...updates } as Loan;
      loadAccount(updatedLoan);
    } catch (error: any) {
      alert('Error updating profile: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredLoans = loans.filter(loan => {
    const matchesSearch = 
      loan.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      loan.mobile.includes(searchTerm) ||
      loan.iid.toString().includes(searchTerm);
    const matchesStatus = filterStatus === 'all' || loan.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="premium-container" style={{ padding: '0', maxWidth: '1000px' }}>
      <header style={{ background: '#d97706', color: '#fff', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700 }}>💰 Loan Manager</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          {loading && <span style={{ fontSize: '12px', opacity: 0.8 }}>Loading...</span>}
          <button className="btn-gold" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={fetchData}>🔄 Refresh</button>
        </div>
      </header>

      <nav style={{ background: '#fff', borderBottom: '1px solid #eee', display: 'flex' }}>
        {['dash', 'all', 'new'].map(tab => (
          <button 
            key={tab}
            onClick={() => { setActiveTab(tab); if (tab !== 'acct') setSearchParams({}); }}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              color: activeTab === (tab === 'dash' && activeTab === 'acct' ? 'acct' : tab) ? '#2563eb' : '#6b7280',
              borderBottom: activeTab === tab ? '3px solid #2563eb' : '3px solid transparent'
            }}
          >
            {tab === 'dash' ? '📊 Dashboard' : tab === 'all' ? '📋 All Loans' : '➕ New Loan'}
          </button>
        ))}
      </nav>

      <style>{`
        @media (max-width: 768px) {
          .premium-container { padding: 0 !important; }
          .dashboard-grid { grid-template-columns: 1fr 1fr !important; }
          .account-profile-header { flex-direction: column !important; align-items: flex-start !important; gap: 15px !important; }
          .stats-grid { grid-template-columns: 1fr 1fr !important; }
          .txn-table th, .txn-table td { padding: 8px !important; font-size: 11px !important; }
          .mobile-hide { display: none !important; }
        }
      `}</style>

      <main style={{ padding: isMobile ? '10px' : '20px' }}>
        {activeTab === 'dash' && (
          <div className="dashboard-content">
            <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div className="sc s1" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #059669', boxShadow: 'var(--shadow-soft)', cursor: 'pointer' }} onClick={() => { setFilterStatus('active'); setActiveTab('all'); }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>ACTIVE LOANS</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#059669' }}>{stats.active}</div>
                <div style={{ fontSize: '10px', color: '#888' }}>{tk(stats.disbursed)} disbursed</div>
              </div>
              <div className="sc s3" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #dc2626', boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>OUTSTANDING (ASOL)</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#dc2626' }}>{tk(stats.outstandingAsol)}</div>
              </div>
              <div className="sc s3" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #d97706', boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>OUTSTANDING (MUNAAFA)</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#d97706' }}>{tk(stats.outstandingMunafa)}</div>
              </div>
              <div className="sc s2" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #2563eb', boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>TOTAL COLLECTED</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#2563eb' }}>{tk(stats.totalCollected)}</div>
                <div style={{ fontSize: '10px', color: '#888' }}>Asol: {tk(stats.totalCollAsol)} | Munafa: {tk(stats.totalCollMunafa)}</div>
              </div>
              <div className="sc s4" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #7c3aed', boxShadow: 'var(--shadow-soft)', cursor: 'pointer' }} onClick={() => { setFilterStatus('closed'); setActiveTab('all'); }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>CLOSED LOANS</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#7c3aed' }}>{stats.closedLoans}</div>
              </div>
              <div className="sc bad" style={{ background: 'white', padding: '20px', borderRadius: '16px', borderLeft: '4px solid #6b7280', boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ fontSize: '10px', color: '#666', fontWeight: 700 }}>BAD DEBT (UNPAID)</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#6b7280' }}>{tk(stats.badDebtAmount)}</div>
                <div style={{ fontSize: '10px', color: '#888' }}>{stats.badDebtCount} loans</div>
              </div>
            </div>

            <section style={{ marginTop: '30px' }}>
              <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: 'var(--shadow-soft)' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '15px' }}>⏰ Recent Activity</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                        <th style={{ padding: '12px', fontSize: '12px' }}>Date</th>
                        <th style={{ padding: '12px', fontSize: '12px' }}>IID</th>
                        <th style={{ padding: '12px', fontSize: '12px' }}>Name</th>
                        <th style={{ padding: '12px', fontSize: '12px', textAlign: 'right' }}>Debit</th>
                        <th style={{ padding: '12px', fontSize: '12px', textAlign: 'right' }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.slice(-10).reverse().map(txn => {
                        const loan = loans.find(l => l.id === txn.loan_id);
                        return (
                          <tr key={txn.id} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => loan && openAccount(loan.id)}>
                            <td style={{ padding: '12px', fontSize: '13px' }}>{fmtDate(txn.txn_date)}</td>
                            <td style={{ padding: '12px', fontSize: '13px' }}>#{loan?.iid}</td>
                            <td style={{ padding: '12px', fontSize: '13px' }}>{loan?.name}</td>
                            <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', color: '#dc2626' }}>
                              {txn.amount < 0 ? tk(-txn.amount) : '-'}
                            </td>
                            <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', color: '#059669' }}>
                              {txn.amount > 0 ? tk(txn.amount) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                      {transactions.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ padding: '30px', textAlign: 'center', color: '#9ca3af' }}>No recent activity</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === 'all' && (
          <div className="listing-content">
            <div style={{ 
              display: 'flex', 
              gap: '10px', 
              marginBottom: '20px',
              background: 'white',
              padding: '16px',
              borderRadius: '16px',
              boxShadow: 'var(--shadow-soft)',
              flexWrap: 'wrap',
              alignItems: 'center'
            }}>
              <input 
                type="text" 
                placeholder="🔍 Search Name/Mobile/IID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  flex: '2',
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: '1.5px solid #eee',
                  fontSize: '14px',
                  minWidth: '200px'
                }}
              />
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                style={{
                  flex: '1',
                  padding: '10px',
                  borderRadius: '10px',
                  border: '1.5px solid #eee',
                  fontSize: '14px',
                  minWidth: '120px'
                }}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: 'var(--shadow-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center' }}>
                <h3 style={{ fontSize: '16px', fontWeight: 700 }}>📋 Loan Records</h3>
                <span style={{ 
                  background: '#2563eb', 
                  color: 'white', 
                  padding: '2px 10px', 
                  borderRadius: '20px', 
                  fontSize: '11px', 
                  fontWeight: 700 
                }}>
                  {filteredLoans.length} Loans
                </span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                      <th style={{ padding: '12px', fontSize: '12px' }}>IID</th>
                      <th style={{ padding: '12px', fontSize: '12px' }}>Date</th>
                      <th style={{ padding: '12px', fontSize: '12px' }}>Name</th>
                      <th style={{ padding: '12px', fontSize: '12px' }}>Mobile</th>
                      <th style={{ padding: '12px', fontSize: '12px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '12px', fontSize: '12px', textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLoans.map(loan => (
                      <tr key={loan.id} style={{ borderBottom: '1px solid #eee', cursor: 'pointer' }} onClick={() => openAccount(loan.id)}>
                        <td style={{ padding: '12px', fontSize: '13px' }}><span style={{ fontWeight: 800 }}>#{loan.iid}</span></td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>{fmtDate(loan.loan_date)}</td>
                        <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600 }}>{loan.name}</td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>{loan.mobile}</td>
                        <td style={{ padding: '12px', fontSize: '13px', textAlign: 'right', fontWeight: 700 }}>{tk(loan.loan_amount)}</td>
                        <td style={{ padding: '12px', fontSize: '13px', textAlign: 'center' }}>
                          <span style={{ 
                            padding: '2px 8px', 
                            borderRadius: '6px', 
                            fontSize: '10px', 
                            fontWeight: 700,
                            background: loan.status === 'active' ? '#ecfdf5' : '#fef2f2',
                            color: loan.status === 'active' ? '#059669' : '#dc2626'
                          }}>
                            {loan.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'new' && (
          <div className="form-content">
            <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: 'var(--shadow-soft)' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid #f3f4f6', paddingBottom: '10px' }}>➕ নতুন লোন তৈরি করুন</h3>
              <form onSubmit={async (e) => {
                e.preventDefault();
                setLoading(true);
                const formData = new FormData(e.currentTarget);
                const loanData = Object.fromEntries(formData.entries());
                try {
                  const { data, error } = await supabase.from('loans').insert([{
                    name: loanData.name,
                    mobile: loanData.mobile,
                    nid_number: loanData.nid_number || null,
                    loan_date: loanData.loan_date,
                    loan_amount: parseFloat(loanData.loan_amount as string),
                    interest_rate: parseFloat(loanData.interest_rate as string),
                    loan_months: parseInt(loanData.loan_months as string),
                    deposit_item: loanData.deposit_item || null,
                    remarks: loanData.remarks || null,
                    status: 'active'
                  }]).select();
                  if (error) throw error;
                  if (data) {
                    alert(`✅ লোন তৈরি হয়েছে! IID: #${data[0].iid}`);
                    fetchData();
                    setActiveTab('all');
                  }
                } catch (error) {
                  alert('Error saving loan');
                } finally {
                  setLoading(false);
                }
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                   <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#4b5563' }}>নাম *</label>
                    <input name="name" type="text" required style={{ padding: '10px', borderRadius: '8px', border: '1.5px solid #eee' }} />
                  </div>
                  <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#4b5563' }}>মোবাইল *</label>
                    <input name="mobile" type="tel" required style={{ padding: '10px', borderRadius: '8px', border: '1.5px solid #eee' }} />
                  </div>
                  <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#4b5563' }}>লোনের পরিমাণ *</label>
                    <input name="loan_amount" type="number" required style={{ padding: '10px', borderRadius: '8px', border: '1.5px solid #eee' }} />
                  </div>
                  <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#4b5563' }}>মুনাফার হার (%) *</label>
                    <input name="interest_rate" type="number" defaultValue="3" required style={{ padding: '10px', borderRadius: '8px', border: '1.5px solid #eee' }} />
                  </div>
                  <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#4b5563' }}>তারিখ *</label>
                    <input name="loan_date" type="date" defaultValue={new Date().toLocaleDateString('en-CA')} required style={{ padding: '10px', borderRadius: '8px', border: '1.5px solid #eee' }} />
                  </div>
                </div>
                <button type="submit" disabled={loading} style={{ marginTop: '20px', width: '100%', padding: '14px', background: '#d97706', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}>
                  {loading ? 'সংরক্ষণ করা হচ্ছে...' : '💾 লোন সংরক্ষণ করুন'}
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'acct' && selectedLoan && loanInfo && (
          <div className="account-content">
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <button onClick={() => { setActiveTab('all'); setSearchParams({}); setIsEditingProfile(false); }} style={{ padding: '8px 16px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>←Back</button>
              <button onClick={exportReport} style={{ padding: '8px 16px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}><div>📄</div> Export</button>
              <button onClick={() => setIsEditingProfile(true)} style={{ padding: '8px 16px', background: '#374151', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '5px' }}><div>✏️</div> তথ্য পরিবর্তন</button>
            </div>

            {isEditingProfile ? (
              <div style={{ background: '#f9fafb', borderRadius: '16px', border: '1px solid #e5e7eb', boxShadow: 'var(--shadow-soft)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid #e5e7eb', background: 'white', borderRadius: '16px 16px 0 0' }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, margin: 0 }}>✏️ গ্রাহক ও লোনের তথ্য পরিবর্তন</h2>
                  <button type="button" onClick={() => setIsEditingProfile(false)} style={{ background: 'white', border: '1px solid #d1d5db', fontSize: '12px', fontWeight: 700, padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', color: '#111827', display: 'flex', alignItems: 'center', gap: '4px' }}>✕ বন্ধ করুন</button>
                </div>
                
                <div style={{ padding: '20px' }}>
                  {/* Miniature Profile Card */}
                  <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <div style={{ width: '50px', height: '50px', background: '#e5e7eb', borderRadius: '10px', border: '2px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', overflow: 'hidden' }}>
                        🕵️
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: '#111827' }}>{selectedLoan.name}</h3>
                          <span style={{ fontSize: '14px', fontWeight: 800, color: '#374151' }}>#{selectedLoan.iid}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '11px', color: '#6b7280', fontWeight: 700 }}>
                          <span>📱 {selectedLoan.mobile}</span>
                          <span>📊 {selectedLoan.interest_rate}%/মাস</span>
                          <span>📅 {fmtDate(selectedLoan.loan_date)}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: '#059669' }}>
                        {selectedLoan.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}
                      </span>
                    </div>
                  </div>

                  <form onSubmit={handleUpdateProfile}>

                    {/* Section 1: Customer Info */}
                    <div style={{ marginBottom: '25px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#2563eb', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        👤 গ্রাহকের তথ্য
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '15px', marginBottom: '15px' }}>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>পূর্ণ নাম</label>
                          <input name="name" type="text" defaultValue={selectedLoan.name} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>মোবাইল নম্বর</label>
                          <input name="mobile" type="tel" defaultValue={selectedLoan.mobile} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                      </div>
                      <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '15px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>NID নম্বর</label>
                        <input name="nid_number" type="text" defaultValue={selectedLoan.nid_number || ''} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px' }} />
                      </div>
                      <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '15px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>জামানত (বন্ধক রাখা জিনিস)</label>
                        <input name="deposit_item" type="text" defaultValue={selectedLoan.deposit_item || ''} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px' }} />
                      </div>
                      <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>অতিরিক্ত মন্তব্য</label>
                        <input name="remarks" type="text" defaultValue={selectedLoan.remarks || ''} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px' }} />
                      </div>
                    </div>

                    {/* Section 2: Loan Info */}
                    <div style={{ marginBottom: '25px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#2563eb', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        💰 লোনের তথ্য
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '15px', marginBottom: '15px' }}>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>লোনের পরিমাণ</label>
                          <input name="loan_amount" type="number" defaultValue={(selectedLoan.loan_amount as any)} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>সুদের হার (%)</label>
                          <input name="interest_rate" type="number" step="0.01" defaultValue={(selectedLoan.interest_rate as any)} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '15px', marginBottom: '15px' }}>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>মেয়াদ (মাস)</label>
                          <input name="loan_months" type="number" defaultValue={(selectedLoan.loan_months as any)} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>লোনের তারিখ</label>
                          <input name="loan_date" type="date" defaultValue={selectedLoan.loan_date.split('T')[0]} required style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }} />
                        </div>
                      </div>
                      <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>বর্তমান স্ট্যাটাস</label>
                        <select name="status" defaultValue={selectedLoan.status} style={{ padding: '10px 12px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f9fafb', fontSize: '13px', fontWeight: 600, color: '#111827' }}>
                          <option value="active">সক্রিয় (Active)</option>
                          <option value="closed">বন্ধ (Closed)</option>
                        </select>
                      </div>
                    </div>

                    {/* Section 3: Photo Update */}
                    <div style={{ marginBottom: '25px' }}>
                      <h4 style={{ fontSize: '14px', fontWeight: 800, color: '#2563eb', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        📷 ছবি পরিবর্তন
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '15px' }}>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>নতুন ছবি</label>
                          <div style={{ display: 'inline-flex', padding: '6px 12px', background: '#eff6ff', color: '#2563eb', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', width: 'fit-content' }}>
                            📷 ছবি আপলোড
                          </div>
                        </div>
                        <div className="fi" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <label style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280' }}>নতুন NID ছবি</label>
                          <div style={{ display: 'inline-flex', padding: '6px 12px', background: '#eff6ff', color: '#2563eb', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', width: 'fit-content' }}>
                            🪪 NID আপলোড
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Section 4: Transaction Management */}
                    <div style={{ marginBottom: '25px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1.5px solid #e5e7eb', marginTop: '20px', paddingTop: '15px', paddingBottom: '10px' }}>
                         <label style={{ color: '#111827', fontWeight: 800, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>💸 লেনদেন ম্যানেজমেন্ট</label>
                         <button type="button" style={{ background: '#eff6ff', color: '#2563eb', border: '1.5px solid #2563eb', fontSize: '11px', fontWeight: 700, padding: '5px 10px', borderRadius: '6px', cursor: 'pointer' }}>
                           ➕ নতুন লোন প্রদান (Top-up)
                         </button>
                      </div>
                      <div style={{ border: '1px solid #d1d5db', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                            <thead style={{ background: '#f9fafb', position: 'sticky', top: 0, zIndex: 1 }}>
                              <tr>
                                <th style={{ padding: '6px', fontWeight: 800, borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', textAlign: 'left' }}>তারিখ</th>
                                <th style={{ padding: '6px', fontWeight: 800, color: '#dc2626', borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', textAlign: 'center' }}>DEBIT</th>
                                <th style={{ padding: '6px', fontWeight: 800, color: '#059669', borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', textAlign: 'center' }}>CREDIT</th>
                                <th style={{ padding: '6px', fontWeight: 800, borderBottom: '1px solid #d1d5db', borderRight: '1px solid #d1d5db', textAlign: 'left' }}>বিবরণ (REMARKS)</th>
                                <th style={{ padding: '6px', fontWeight: 800, borderBottom: '1px solid #d1d5db', textAlign: 'left' }}>অ্যাকশন</th>
                              </tr>
                            </thead>
                            <tbody>
                              {transactions.filter(t => t.loan_id === selectedLoan.id).map((t, i) => {
                                const amt = parseFloat(t.amount as any);
                                const isTopup = amt < 0;
                                const displayAmt = Math.abs(amt);
                                return (
                                  <tr key={i} style={{ borderBottom: '1px solid #f0f0f0', background: isTopup ? '#fef2f2' : 'white' }}>
                                    <td style={{ padding: '8px 6px', borderRight: '1px solid #d1d5db', fontWeight: 600 }}>{fmtDate(t.txn_date)}</td>
                                    <td style={{ padding: '8px 6px', borderRight: '1px solid #d1d5db', fontWeight: 700, color: '#dc2626', textAlign: 'right' }}>{isTopup ? tk(displayAmt) : '-'}</td>
                                    <td style={{ padding: '8px 6px', borderRight: '1px solid #d1d5db', fontWeight: 700, color: '#059669', textAlign: 'right' }}>{!isTopup ? tk(displayAmt) : '-'}</td>
                                    <td style={{ padding: '8px 6px', borderRight: '1px solid #d1d5db', color: '#6b7280', fontSize: '10px' }}>{t.remarks || '-'}</td>
                                    <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                        <button type="button" style={{ background: 'white', border: '1.5px solid #d1d5db', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}>✏️</button>
                                        <button type="button" style={{ background: 'white', border: '1.5px solid #d1d5db', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}>🗑️</button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '15px', marginTop: '20px' }}>
                      <button type="submit" disabled={loading} style={{ flex: 1, padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                        💾 Update
                      </button>
                      <button type="button" onClick={() => setIsEditingProfile(false)} style={{ flex: 1, padding: '12px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 800, fontSize: '13px', cursor: 'pointer' }}>
                        Close
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              // View Mode
              <>
            <div className="account-profile-header" style={{ display: 'flex', gap: '20px', alignItems: 'center', marginBottom: '25px' }}>
              <div style={{ width: isMobile ? '70px' : '80px', height: isMobile ? '70px' : '80px', flexShrink: 0, background: '#e5e7eb', borderRadius: '16px', border: '3px solid #3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isMobile ? '30px' : '40px', overflow: 'hidden' }}>
                🕵️
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: isMobile ? '20px' : '24px', fontWeight: 800, color: '#111827', margin: 0 }}>{selectedLoan.name}</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#374151' }}>#{selectedLoan.iid}</span>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '10px', height: '10px', background: '#059669', borderRadius: '50%', display: 'inline-block' }}></span>
                    {selectedLoan.status === 'active' ? 'সক্রিয়' : 'বন্ধ'}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '8px' : '15px', marginTop: '10px', fontSize: isMobile ? '11px' : '13px', color: '#4b5563', fontWeight: 700 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>📱 <span style={{ color: '#111827' }}>{selectedLoan.mobile}</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#9ca3af' }}>📞 N/A</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? '8px' : '15px', marginTop: '5px', fontSize: isMobile ? '11px' : '13px', color: '#4b5563', fontWeight: 700 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>📅 <span style={{ color: '#111827' }}>{fmtDate(selectedLoan.loan_date)}</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>🗓️ <span style={{ color: '#111827' }}>{selectedLoan.loan_months} মাস</span></span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>📊 <span style={{ color: '#111827' }}>{selectedLoan.interest_rate}%/মাস</span></span>
                </div>
              </div>
            </div>

            <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: isMobile ? '10px' : '15px', marginBottom: '15px' }}>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #2563eb' }}>
                <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 800, color: '#2563eb' }}>{tk(selectedLoan.loan_amount)}</div>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>💰 মূল লোন</div>
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #2563eb' }}>
                <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 800, color: '#2563eb' }}>{tk(loanInfo.principal)}</div>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>📉 বর্তমান আসল</div>
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #d97706' }}>
                <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 800, color: '#d97706' }}>{tk(loanInfo.interest_owed)}</div>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>📈 বকেয়া মুনাফা</div>
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #059669' }}>
                <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 800, color: '#059669' }}>{tk(loanInfo.totalPaid)}</div>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>💵 মোট জমা</div>
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #dc2626' }}>
                <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 800, color: '#dc2626' }}>{tk(loanInfo.currentDue)}</div>
                <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>💸 মোট বকেয়া</div>
              </div>
              <div style={{ background: 'white', padding: '15px', borderRadius: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', textAlign: 'center', borderBottom: '3px solid #7c3aed' }}>
                <div style={{ fontSize: isMobile ? '13px' : '16px', fontWeight: 800, color: '#7c3aed' }}>
                  {fmtDate(new Date(new Date(selectedLoan.loan_date).setMonth(new Date(selectedLoan.loan_date).getMonth() + parseInt(selectedLoan.loan_months as any))))}
                </div>
                <div style={{ fontSize: '9px', color: '#6b7280', fontWeight: 700, marginTop: '4px' }}>📅 মেয়াদের তারিখ</div>
                <div style={{ fontSize: '9px', color: '#7c3aed', fontWeight: 600 }}>({Math.ceil((new Date(new Date(selectedLoan.loan_date).setMonth(new Date(selectedLoan.loan_date).getMonth() + parseInt(selectedLoan.loan_months as any))).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} দিন বাকি)</div>
              </div>
            </div>

            <button onClick={() => { setPayMode('normal'); setShowPayModal(true); }} style={{ width: '100%', padding: '16px', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 800, fontSize: '18px', marginBottom: '25px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: '0 4px 6px rgba(5, 150, 105, 0.2)' }}>
              💵 টাকা জমা দিন
            </button>

            <div style={{ background: 'white', borderRadius: '16px', padding: isMobile ? '10px 5px' : '20px', boxShadow: 'var(--shadow-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '10px', paddingLeft: isMobile ? '5px' : '0' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📊</span> ব্যাংক স্টেটমেন্ট
                </h3>
                <span style={{ background: '#2563eb', color: 'white', padding: '2px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 800 }}>{loanInfo.history.length}</span>
              </div>
              <div style={{ overflowX: 'auto', margin: isMobile ? '0 -5px' : '0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black', fontFamily: 'Inter, sans-serif' }}>
                  <thead>
                    <tr style={{ background: '#ffffff', textAlign: 'left' }}>
                      <th style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '10px' : '12px', fontWeight: 800, minWidth: isMobile ? '60px' : 'auto' }}>DATE</th>
                      <th style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '10px' : '12px', fontWeight: 800, minWidth: isMobile ? '80px' : 'auto' }}>DESCRIPTION</th>
                      <th style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '10px' : '12px', textAlign: 'center', color: '#d32f2f', fontWeight: 800, minWidth: isMobile ? '60px' : 'auto' }}>DEBIT</th>
                      <th style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '10px' : '12px', textAlign: 'center', color: '#388e3c', fontWeight: 800, minWidth: isMobile ? '60px' : 'auto' }}>CREDIT</th>
                      <th style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '10px' : '12px', textAlign: 'center', fontWeight: 800, minWidth: isMobile ? '70px' : 'auto' }}>BALANCE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loanInfo.history.map((h, i) => (
                      <tr key={i} style={{ background: h.isInterest ? '#fffae6' : h.isLog ? '#f0f9ff' : '#ffffff' }}>
                        <td style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '11px' : '14px' }}>{fmtDate(h.date)}</td>
                        <td style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '11px' : '14px' }}>{h.desc}</td>
                        <td style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '11px' : '14px', textAlign: 'right', color: '#d32f2f', fontWeight: 600 }}>{h.debit > 0 ? tk(h.debit) : '-'}</td>
                        <td style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '11px' : '14px', textAlign: 'right', color: '#388e3c', fontWeight: 600 }}>{h.credit > 0 ? tk(h.credit) : '-'}</td>
                        <td style={{ border: '1px solid black', padding: isMobile ? '8px 4px' : '12px', fontSize: isMobile ? '11px' : '14px', textAlign: 'right', fontWeight: 800 }}>{tk(h.balance)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#f5f5f5' }}>
                      <td colSpan={2} style={{ border: '1px solid black', padding: isMobile ? '10px 5px' : '15px', fontSize: isMobile ? '11px' : '14px', textAlign: 'right', fontWeight: 800 }}>
                        {isMobile ? 'বর্তমান স্থিতি' : `বর্তমান স্থিতি (${fmtDate(new Date().toLocaleDateString('en-CA'))}):`}
                      </td>
                      <td style={{ border: '1px solid black', padding: isMobile ? '10px 5px' : '15px', fontSize: isMobile ? '11px' : '14px', textAlign: 'center', color: '#d97706', fontWeight: 800 }}>
                        {loanInfo.currentInterest > 0 ? (isMobile ? `+${tk(loanInfo.currentInterest)}` : `+${tk(loanInfo.currentInterest)} (নতুন মুনাফা)`) : '-'}
                      </td>
                      <td style={{ border: '1px solid black', padding: isMobile ? '10px 5px' : '15px', fontSize: isMobile ? '10px' : '13px', textAlign: 'center', color: '#1e3a8a', fontWeight: 700, lineHeight: '1.4' }}>
                        {isMobile ? `আঃ ${tk(loanInfo.principal)}` : `আসল: ${tk(loanInfo.principal)}`}<br/>
                        {isMobile ? `মুঃ ${tk(loanInfo.pending_interest)}` : `মুনাফা: ${tk(loanInfo.pending_interest)}`}
                      </td>
                      <td style={{ border: '1px solid black', padding: isMobile ? '10px 5px' : '15px', fontSize: isMobile ? '12px' : '16px', textAlign: 'center', fontWeight: 800, color: '#dc2626' }}>
                        {isMobile ? tk(loanInfo.currentDue) : `মোট: ${tk(loanInfo.currentDue)}`}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Summary Stats below the table */}
              <div style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: isMobile ? '10px' : '20px', marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                <div style={{ textAlign: isMobile ? 'center' : 'right', flex: isMobile ? '1' : '0 1 auto' }}>
                  <div style={{ fontSize: isMobile ? '10px' : '12px', color: '#6b7280', fontWeight: 600 }}>মোট আসল =</div>
                  <div style={{ fontSize: isMobile ? '14px' : '18px', fontWeight: 800, color: '#111827' }}>{tk(loanInfo.principal)}</div>
                </div>
                <div style={{ textAlign: isMobile ? 'center' : 'right', flex: isMobile ? '1' : '0 1 auto' }}>
                  <div style={{ fontSize: isMobile ? '10px' : '12px', color: '#6b7280', fontWeight: 600 }}>মোট মুনাফা =</div>
                  <div style={{ fontSize: isMobile ? '14px' : '18px', fontWeight: 800, color: '#d97706' }}>{tk(loanInfo.pending_interest + loanInfo.currentInterest)}</div>
                </div>
                <div style={{ textAlign: isMobile ? 'center' : 'right', borderLeft: isMobile ? '1px solid #eee' : 'none', paddingLeft: isMobile ? '10px' : '0', flex: isMobile ? '1.2' : '0 1 auto' }}>
                  <div style={{ fontSize: isMobile ? '10px' : '12px', color: '#6b7280', fontWeight: 600 }}>মোট পাওনা =</div>
                  <div style={{ fontSize: isMobile ? '16px' : '20px', fontWeight: 900, color: '#dc2626' }}>{tk(loanInfo.currentDue)}</div>
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', marginTop: '20px', paddingBottom: '10px' }}>
              <button type="button" onClick={() => alert('লোন ক্লোজ ফিচারটি খুব শীঘ্রই আসছে!')} style={{ background: 'white', color: '#dc2626', border: '1px solid #dc2626', padding: '8px 20px', borderRadius: '4px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontSize: '16px' }}>🚫</span> লোন বন্ধ করুন (Close Loan)
              </button>
            </div>
            </>
            )}
          </div>
        )}
      </main>

      {showPayModal && selectedLoan && loanInfo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '24px', width: '100%', maxWidth: '400px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)', position: 'relative', overflow: 'hidden' }}>
            {/* Modal Header */}
            <div style={{ padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', color: '#111827' }}>
                <span style={{ fontSize: '20px' }}>💵</span> টাকা জমা দিন ( {selectedLoan.name} )
              </h3>
              <button 
                onClick={() => setShowPayModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '24px', color: '#9ca3af', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePayment} style={{ padding: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Date Input */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#4b5563', marginBottom: '6px' }}>জমার তারিখ</label>
                  <input 
                    name="date" 
                    type="date" 
                    defaultValue={new Date().toLocaleDateString('en-CA')} 
                    required 
                    style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '14px', background: '#f9fafb', fontWeight: 600 }} 
                  />
                </div>

                {/* Total Amount Input */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#4b5563', marginBottom: '6px' }}>মোট জমার পরিমাণ</label>
                  <input 
                    name="amount" 
                    type="number" 
                    step=".01" 
                    placeholder="0.00" 
                    required 
                    style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '14px', background: '#f9fafb', fontWeight: 600 }} 
                  />
                </div>

                {/* Split Inputs */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', marginBottom: '6px' }}>আসল জমা (Principal)</label>
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '13px', background: '#f9fafb' }} 
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#6b7280', marginBottom: '6px' }}>মুনাফা জমা (Profit)</label>
                    <input 
                      type="number" 
                      placeholder="0.00" 
                      style={{ width: '100%', padding: '10px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '13px', background: '#f9fafb' }} 
                    />
                  </div>
                </div>

                {/* Remarks Input */}
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#4b5563', marginBottom: '6px' }}>মন্তব্য</label>
                  <input 
                    name="remarks" 
                    type="text" 
                    placeholder="ঐচ্ছিক" 
                    style={{ width: '100%', padding: '12px', borderRadius: '10px', border: '1.5px solid #e5e7eb', fontSize: '14px', background: '#f9fafb' }} 
                  />
                </div>

                {/* Calculation Info Box */}
                <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: '12px', padding: '16px', marginTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', border: '1px solid #3b82f6', background: '#eff6ff', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ textAlign: 'center', flex: 1, borderRight: '1px solid #bfdbfe' }}>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>আসল বকেয়া</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>{tk(loanInfo.principal)}</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1, borderRight: '1px solid #bfdbfe' }}>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>বকেয়া মুনাফা</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#111827' }}>{tk(loanInfo.interest_owed)}</div>
                    </div>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                      <div style={{ fontSize: '9px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>মোট পাওনা</div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#dc2626' }}>{tk(loanInfo.currentDue)}</div>
                    </div>
                  </div>
                </div>

                {/* Submit Button */}
                <button 
                  type="submit" 
                  disabled={loading} 
                  style={{ 
                    width: '100%', 
                    padding: '16px', 
                    background: '#059669', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '12px', 
                    fontWeight: 800, 
                    fontSize: '16px', 
                    cursor: 'pointer', 
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 6px -1px rgba(5, 150, 105, 0.2)'
                  }}
                >
                  <span style={{ fontSize: '18px' }}>💵</span> জমা নিশ্চিত করুন
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: '20px', paddingBottom: '40px' }}>
        <Link to="/" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>← Back to Portal</Link>
      </div>
    </div>
  );
};

export default LoanManager;
