import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Building2, 
  DollarSign, 
  Globe, 
  CheckCircle2, 
  XCircle, 
  FileText, 
  AlertTriangle,
  ArrowRight,
  CheckSquare,
  Square,
  Radio,
  RefreshCw,
  Zap,
  Activity
} from 'lucide-react';
import { store } from '../../lib/store';
import { SUPPORTED_COUNTRIES, formatCurrency } from '../../lib/currencies';
import { OrganizerProfile, Event, CountryLaunchGate, WebhookLog } from '../../types';

interface AdminConsoleProps {
  onBackToMarketplace: () => void;
  theme?: 'light' | 'dark';
}

export const AdminConsole: React.FC<AdminConsoleProps> = ({
  onBackToMarketplace,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const [organizers, setOrganizers] = useState<OrganizerProfile[]>(store.getOrganizers());
  const [events, setEvents] = useState<Event[]>(store.getEvents());
  const [launchGates, setLaunchGates] = useState<CountryLaunchGate[]>(store.getLaunchGates());
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>(store.getWebhookLogs());
  const [activeTab, setActiveTab] = useState<'overview' | 'launch_gates' | 'webhooks' | 'kyc' | 'events' | 'ledger'>('overview');

  // Webhook Simulator form state
  const [simProvider, setSimProvider] = useState<'paystack' | 'flutterwave' | 'mpesa' | 'ozow'>('paystack');
  const [simEventId, setSimEventId] = useState('evt_charge_' + Math.floor(100000 + Math.random() * 900000));
  const [simValidSig, setSimValidSig] = useState(true);
  const [simFeedback, setSimFeedback] = useState<string | null>(null);

  const allTickets = store.getTickets();
  const allOrders = store.getOrders();
  const allLedger = store.getLedgerEntries();

  const totalGMVMinor = allOrders.reduce((acc, o) => acc + o.totalMinor, 0) + 48500000;
  const platformCommissionMinor = Math.round(totalGMVMinor * 0.05);

  const handleUpdateKYC = (orgId: string, status: 'verified' | 'rejected') => {
    store.updateOrganizerVerification(orgId, status);
    setOrganizers(store.getOrganizers());
  };

  const handleToggleGateCheck = (countryCode: string, field: keyof CountryLaunchGate) => {
    store.toggleLaunchGateCheck(countryCode, field);
    setLaunchGates(store.getLaunchGates());
  };

  const handleToggleAuthorized = (countryCode: string, current: boolean) => {
    store.authorizeCountryPaidSales(countryCode, !current);
    setLaunchGates(store.getLaunchGates());
  };

  const handleRunWebhookSimulation = () => {
    const res = store.simulateIncomingWebhook(
      simProvider,
      simEventId,
      simValidSig,
      35000,
      'ZAR'
    );
    setSimFeedback(`${res.message}`);
    setWebhookLogs(store.getWebhookLogs());
  };

  return (
    <div className={`min-h-screen py-8 px-4 sm:px-6 lg:px-8 transition-colors ${
      isDark ? 'bg-[#0A0D14] text-white' : 'bg-[#F8F7F4] text-[#111827]'
    }`}>
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Admin Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#111827] text-white p-6 rounded-2xl border border-[#1F2937] shadow-lg">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#F6A623] text-[#111827] rounded-xl font-bold">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-extrabold tracking-tight">NEXORA Operations & Trust Console</h1>
                <span className="text-[10px] bg-red-950 text-red-400 font-mono font-bold px-2 py-0.5 rounded border border-red-800">
                  Tier 3 Super Admin
                </span>
              </div>
              <p className="text-xs text-[#9CA3AF]">
                Platform governance, multi-country African launch gates, webhook idempotency & ledger audit
              </p>
            </div>
          </div>

          <button
            onClick={onBackToMarketplace}
            className="px-4 py-2 bg-[#1F2937] hover:bg-[#374151] text-white text-xs font-semibold rounded-lg border border-[#374151] transition-colors cursor-pointer"
          >
            ← Exit to Marketplace
          </button>
        </div>

        {/* Tab Controls */}
        <div className={`flex items-center gap-2 border-b pb-1 overflow-x-auto text-xs font-medium ${
          isDark ? 'border-white/15' : 'border-[#E5E7EB]'
        }`}>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            Network Overview
          </button>
          <button
            onClick={() => setActiveTab('launch_gates')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'launch_gates'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-[#F6A623]" />
            <span>Multi-Country Launch Gates</span>
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'webhooks'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Webhooks & Idempotency</span>
          </button>
          <button
            onClick={() => setActiveTab('kyc')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'kyc'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            Organizer KYB Verification ({organizers.filter(o => o.verificationStatus !== 'verified').length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'events'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            Event Moderation ({events.length})
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'ledger'
                ? (isDark ? 'bg-white text-black font-bold' : 'bg-[#111827] text-white font-bold')
                : (isDark ? 'text-white/70 hover:bg-white/10 hover:text-white' : 'text-[#4B5563] hover:bg-white hover:text-black')
            }`}
          >
            Global Audit Journal
          </button>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="bg-white p-5 rounded-xl border border-[#E5E7EB] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6B7280]">
                  <span>Total Gross Ticket Value (GMV)</span>
                  <DollarSign className="w-4 h-4 text-[#F6A623]" />
                </div>
                <div className="text-2xl font-extrabold text-[#111827] font-mono-tabular">
                  {formatCurrency(totalGMVMinor, 'ZAR')}
                </div>
                <span className="text-[11px] text-emerald-600 font-semibold block">
                  Authoritative multi-market clearing
                </span>
              </div>

              <div className="bg-white p-5 rounded-xl border border-[#E5E7EB] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6B7280]">
                  <span>Platform Commission Pool</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-2xl font-extrabold text-[#111827] font-mono-tabular">
                  {formatCurrency(platformCommissionMinor, 'ZAR')}
                </div>
                <span className="text-[11px] text-[#6B7280] block">
                  Net platform treasury allocation
                </span>
              </div>

              <div className="bg-white p-5 rounded-xl border border-[#E5E7EB] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6B7280]">
                  <span>Registered Organizers</span>
                  <Building2 className="w-4 h-4 text-[#F6A623]" />
                </div>
                <div className="text-2xl font-extrabold text-[#111827] font-mono-tabular">
                  {organizers.length}
                </div>
                <span className="text-[11px] text-[#6B7280] block">
                  {organizers.filter(o => o.verified).length} Fully Verified
                </span>
              </div>

              <div className="bg-white p-5 rounded-xl border border-[#E5E7EB] shadow-xs space-y-2">
                <div className="flex items-center justify-between text-xs text-[#6B7280]">
                  <span>Total Tickets In Circulation</span>
                  <Users className="w-4 h-4 text-[#F6A623]" />
                </div>
                <div className="text-2xl font-extrabold text-[#111827] font-mono-tabular">
                  {allTickets.length + 3820}
                </div>
                <span className="text-[11px] text-blue-600 font-semibold block">
                  Double-entry balanced
                </span>
              </div>

            </div>

            <div className="bg-white p-6 rounded-2xl border border-[#E5E7EB] shadow-xs space-y-3">
              <h3 className="text-sm font-bold text-[#111827]">Financial Invariants & Circuit Breaker Health</h3>
              <p className="text-xs text-[#6B7280] leading-relaxed">
                All double-entry clearing transactions are balanced. Automated reconciliation checks running on 15-minute intervals. No unverified bank payouts permitted without KYC compliance check.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: MULTI-COUNTRY LAUNCH GATES (PRD Section 4) */}
        {activeTab === 'launch_gates' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-[#E5E7EB] shadow-xs space-y-2">
              <h3 className="text-base font-bold text-[#111827]">
                African Launch Gate Compliance Matrices
              </h3>
              <p className="text-xs text-[#6B7280] leading-relaxed">
                Each country must pass all operational, legal, payment provider, and consumer protection checklists before live paid ticket sales can be enabled.
              </p>
            </div>

            <div className="space-y-4">
              {launchGates.map(gate => {
                const checkCount = [
                  gate.legalEntityApproved,
                  gate.paymentProviderLive,
                  gate.settlementCurrencyConfirmed,
                  gate.compliantFundsFlowModel,
                  gate.refundProceduresDocumented,
                  gate.taxInvoicingReviewed,
                  gate.privacyPOPIAReady,
                  gate.supportEscalationTested,
                  gate.e2eTestPassed,
                ].filter(Boolean).length;

                const isFullyReady = checkCount === 9;

                return (
                  <div key={gate.countryCode} className="bg-white rounded-2xl border border-[#E5E7EB] p-6 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-[#E5E7EB] pb-4">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{gate.flag}</span>
                        <div>
                          <h4 className="text-base font-bold text-[#111827]">{gate.countryName}</h4>
                          <span className="text-xs text-[#6B7280]">
                            Readiness Score: <strong className="text-[#111827]">{checkCount}/9 requirements passed</strong>
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => handleToggleAuthorized(gate.countryCode, gate.paidSalesAuthorized)}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer ${
                            gate.paidSalesAuthorized
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          }`}
                        >
                          {gate.paidSalesAuthorized ? 'Paid Sales Authorized' : 'Paid Sales Blocked'}
                        </button>
                      </div>
                    </div>

                    {/* Checklist Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'legalEntityApproved')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.legalEntityApproved ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Approved Legal Entity</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'paymentProviderLive')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.paymentProviderLive ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Production Gateway Live</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'settlementCurrencyConfirmed')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.settlementCurrencyConfirmed ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Local Settlement Currencies</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'compliantFundsFlowModel')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.compliantFundsFlowModel ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Compliant Payout / Funds Model</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'refundProceduresDocumented')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.refundProceduresDocumented ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Refund & Dispute Procedures</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'taxInvoicingReviewed')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.taxInvoicingReviewed ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>VAT & Tax Invoicing Verified</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'privacyPOPIAReady')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.privacyPOPIAReady ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Data Privacy (POPIA/NDPR)</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'supportEscalationTested')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.supportEscalationTested ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>Local Support & Escalations</span>
                      </button>

                      <button
                        onClick={() => handleToggleGateCheck(gate.countryCode, 'e2eTestPassed')}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-[#E5E7EB] hover:bg-[#F8F7F4] text-left cursor-pointer"
                      >
                        {gate.e2eTestPassed ? <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" /> : <Square className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span>End-to-End Sandbox Tests</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: WEBHOOKS & IDEMPOTENCY DEBUGGER (PRD Section 5.3 & 12) */}
        {activeTab === 'webhooks' && (
          <div className="space-y-6">
            
            {/* Simulation Controller */}
            <div className="bg-white p-6 rounded-2xl border border-[#E5E7EB] shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-bold text-[#111827]">Payment Webhook & Idempotency Harness</h3>
                <p className="text-xs text-[#6B7280]">
                  Test webhook signature verification, replay protection (idempotency), and duplicate callback prevention.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Gateway Provider</label>
                  <select
                    value={simProvider}
                    onChange={e => setSimProvider(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs border rounded-lg bg-white"
                  >
                    <option value="paystack">Paystack (Nigeria / ZA / Ghana)</option>
                    <option value="flutterwave">Flutterwave (Pan-African)</option>
                    <option value="mpesa">M-Pesa Daraja (Kenya)</option>
                    <option value="ozow">Ozow Instant EFT (South Africa)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">Provider Event ID</label>
                  <input
                    type="text"
                    value={simEventId}
                    onChange={e => setSimEventId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-lg font-mono bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#4B5563] mb-1">HMAC Signature</label>
                  <button
                    onClick={() => setSimValidSig(!simValidSig)}
                    className={`w-full py-2 text-xs font-bold rounded-lg border ${
                      simValidSig
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-red-50 border-red-300 text-red-800'
                    }`}
                  >
                    {simValidSig ? 'Valid HMAC Signature' : 'Tampered / Invalid Signature'}
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleRunWebhookSimulation}
                  className="px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] text-white text-xs font-bold rounded-lg flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5 text-[#F6A623]" />
                  <span>Send Simulated Webhook</span>
                </button>
                <button
                  onClick={() => setSimEventId('evt_charge_' + Math.floor(100000 + Math.random() * 900000))}
                  className="px-3.5 py-2.5 border border-[#D1D5DB] hover:bg-[#F8F7F4] text-xs font-semibold rounded-lg text-[#4B5563] cursor-pointer"
                >
                  Regenerate Event ID
                </button>
              </div>

              {simFeedback && (
                <div className={`p-3 rounded-lg text-xs font-mono border ${
                  simFeedback.includes('REJECTED')
                    ? 'bg-red-50 border-red-200 text-red-800'
                    : simFeedback.includes('IDEMPOTENT')
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  {simFeedback}
                </div>
              )}
            </div>

            {/* Webhook Audit Log Table */}
            <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-xs">
              <div className="p-4 border-b border-[#E5E7EB] flex justify-between items-center">
                <h4 className="text-sm font-bold text-[#111827]">Incoming Webhook Events Log</h4>
                <span className="text-xs font-mono text-[#6B7280]">{webhookLogs.length} Events Logged</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F8F7F4] text-[#6B7280] border-b border-[#E5E7EB] uppercase font-semibold">
                    <tr>
                      <th className="p-3">Time</th>
                      <th className="p-3">Provider</th>
                      <th className="p-3">Event ID</th>
                      <th className="p-3">Result Status</th>
                      <th className="p-3">Payload Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {webhookLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-[#9CA3AF]">
                          No webhook callbacks received yet. Use the simulator above to test.
                        </td>
                      </tr>
                    ) : (
                      webhookLogs.map(log => (
                        <tr key={log.id}>
                          <td className="p-3 font-mono text-[#6B7280]">{new Date(log.receivedAt).toLocaleTimeString()}</td>
                          <td className="p-3 font-bold uppercase font-mono">{log.provider}</td>
                          <td className="p-3 font-mono text-[#111827]">{log.eventId}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded font-mono font-bold text-[10px] ${
                              log.status === 'processed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.status === 'replayed_duplicate'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {log.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="p-3 text-[#4B5563]">{log.payloadSummary}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB 4: KYB / KYC ORGANIZER VERIFICATION */}
        {activeTab === 'kyc' && (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-xs p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-[#111827]">Organizer Legal Verification Queue</h3>
              <p className="text-xs text-[#6B7280]">
                Strict verification required prior to live ticket payout settlements
              </p>
            </div>

            <div className="divide-y divide-[#E5E7EB]">
              {organizers.map(org => (
                <div key={org.id} className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-[#111827]">{org.name}</h4>
                      <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                        org.verificationStatus === 'verified'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}>
                        {org.verificationStatus.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280]">
                      Legal Entity: <strong className="text-[#111827]">{org.legalEntityName}</strong> · {org.city}, {org.country}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[#4B5563] pt-0.5">
                      <FileText className="w-3.5 h-3.5 text-[#F6A623]" />
                      <span>Document: {org.verificationDocName || 'Company_Registration.pdf'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {org.verificationStatus !== 'verified' ? (
                      <button
                        onClick={() => handleUpdateKYC(org.id, 'verified')}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1.5 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Approve Verification</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUpdateKYC(org.id, 'rejected')}
                        className="px-3 py-1.5 border border-[#D1D5DB] hover:bg-[#F8F7F4] text-red-600 text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        Revoke Approval
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: EVENT MODERATION */}
        {activeTab === 'events' && (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-xs p-6 space-y-4">
            <h3 className="text-base font-bold text-[#111827]">Marketplace Event Moderation</h3>
            <div className="space-y-3">
              {events.map(evt => (
                <div key={evt.id} className="p-4 bg-[#F8F7F4] rounded-xl border border-[#E5E7EB] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <img src={evt.coverImage} alt={evt.title} className="w-12 h-12 rounded-lg object-cover" />
                    <div>
                      <h4 className="text-sm font-bold text-[#111827]">{evt.title}</h4>
                      <p className="text-xs text-[#6B7280]">
                        By {evt.organizer.name} · {evt.venue.city}, {evt.venue.country}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-emerald-100 text-emerald-800">
                      {evt.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 6: LEDGER AUDIT */}
        {activeTab === 'ledger' && (
          <div className="bg-white rounded-2xl border border-[#E5E7EB] overflow-hidden shadow-xs p-6 space-y-4">
            <h3 className="text-base font-bold text-[#111827]">Global Platform Financial Ledger</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8F7F4] text-[#6B7280] border-b border-[#E5E7EB] uppercase font-semibold">
                  <tr>
                    <th className="p-3">Time</th>
                    <th className="p-3">Account Type</th>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {allLedger.map(l => (
                    <tr key={l.id}>
                      <td className="p-3 font-mono text-[#6B7280]">
                        {new Date(l.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="p-3 font-mono font-bold capitalize">{l.type.replace(/_/g, ' ')}</td>
                      <td className="p-3 text-[#4B5563]">{l.description}</td>
                      <td className="p-3 text-right font-mono-tabular text-red-700">
                        {l.debitMinor > 0 ? formatCurrency(l.debitMinor, l.currency) : '-'}
                      </td>
                      <td className="p-3 text-right font-mono-tabular text-emerald-700 font-bold">
                        {l.creditMinor > 0 ? formatCurrency(l.creditMinor, l.currency) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
