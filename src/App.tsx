import { useEffect, useState, useMemo } from 'react';
import { Header, MobileTabBar } from './components/layout/Header';
import { ActiveModelTab } from './types/common';
import { DEAL_PRESETS } from './presets/deals';
import { DcfAssumptions } from './types/dcf';
import { LboAssumptions } from './types/lbo';
import { ParsedFinancialReport } from './types/statements';
import { runDcfModel } from './models/dcfEngine';
import { runLboModel } from './models/lboEngine';
import { MetricCard } from './components/common/MetricCard';
import { formatCurrency, formatPercent, formatMultiple } from './utils/formatters';

// DCF Components
import { DcfAssumptionsComponent } from './components/dcf/DcfAssumptions';
import { WaccCalculatorComponent } from './components/dcf/WaccCalculator';
import { CashFlowTable } from './components/dcf/CashFlowTable';
import { ValuationBridge } from './components/dcf/ValuationBridge';
import { DcfSensitivity } from './components/dcf/DcfSensitivity';

// LBO Components
import { LboAssumptionsComponent } from './components/lbo/LboAssumptions';
import { SourcesAndUsesComponent } from './components/lbo/SourcesAndUses';
import { DebtWaterfallComponent } from './components/lbo/DebtWaterfall';
import { ReturnsSummaryComponent } from './components/lbo/ReturnsSummary';
import { LboSensitivity } from './components/lbo/LboSensitivity';

// Market Components
import { MarketWorkspace, MarketSubTab } from './components/market/MarketWorkspace';
import { EmitenModelBundle, buildEmitenModel } from './models/idxCompanyBridge';
import { AnalyticsWorkspace, AnalyticsSubTab } from './components/analytics/AnalyticsWorkspace';
import { AuthModal } from './components/auth/AuthModal';
import { AccountUser, fetchAuthState, logOut } from './data/authClient';
import { LandingPage } from './components/landing/LandingPage';
import { LiveStatusBar } from './components/layout/LiveStatusBar';
import { CurtainTransition } from './components/layout/CurtainTransition';
import { MenuPanel } from './components/layout/MenuPanel';
import { FunctionBar } from './components/layout/FunctionBar';
import { TERMINAL_FUNCTIONS, TerminalFunction } from './data/functions';
import { DcfDiagnostics } from './components/dcf/DcfDiagnostics';
import { useMarketData } from './hooks/useMarketData';
import { Segmented } from './components/common/ui';

import { TrendingUp, Layers, DollarSign, Award, BarChart3, Sliders, Table, Sparkles, Check } from 'lucide-react';

type WorkspaceTab = ActiveModelTab | 'market' | 'analytics';

export default function App() {
  const [showLanding, setShowLanding] = useState<boolean>(true);
  // Set while the curtain is sweeping. Holds the destination so the route swap
  // can happen at the exact frame the screen is fully covered.
  const [curtainTo, setCurtainTo] = useState<null | (() => void)>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Account state. `serviceUp` false means the local service is not running, in
  // which case the app stays usable read-only from the bundled data and no
  // sign-in is demanded for something it could not enforce anyway.
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [accountsExist, setAccountsExist] = useState(false);
  const [serviceUp, setServiceUp] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('market');
  const [marketSubTab, setMarketSubTab] = useState<MarketSubTab>('overview');
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>('leaders');
  const [pendingEmiten, setPendingEmiten] = useState<string | null>(null);
  // The last emiten the user actually opened. The ownership tracker starts on
  // it, so switching tabs continues the same investigation instead of resetting
  // to a default ticker.
  const [lastEmiten, setLastEmiten] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEAL_PRESETS[0].id);

  const [dcfAssumptions, setDcfAssumptions] = useState<DcfAssumptions>(DEAL_PRESETS[0].dcf);
  const [lboAssumptions, setLboAssumptions] = useState<LboAssumptions>(DEAL_PRESETS[0].lbo);

  // Set when an emiten is calibrated into the models from the market database.
  const [loadedReport, setLoadedReport] = useState<ParsedFinancialReport | null>(null);

  const [dcfSubTab, setDcfSubTab] = useState<'assumptions' | 'cashflows' | 'valuation' | 'sensitivity'>('assumptions');
  const [lboSubTab, setLboSubTab] = useState<'structure' | 'waterfall' | 'returns' | 'sensitivity'>('structure');

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3800);
  };

  const handleSelectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = DEAL_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setDcfAssumptions(preset.dcf);
      setLboAssumptions(preset.lbo);
      showToast(`Loaded preset deal: "${preset.name}"`);
    }
  };

  const dcfSummary = useMemo(() => runDcfModel(dcfAssumptions), [dcfAssumptions]);
  const lboSummary = useMemo(() => runLboModel(lboAssumptions), [lboAssumptions]);

  /** Load an IDX emiten straight from the market database into both engines. */
  const handleApplyEmitenModel = (bundle: EmitenModelBundle) => {
    setDcfAssumptions(bundle.dcf);
    setLboAssumptions(bundle.lbo);
    setLoadedReport(bundle.report);
    setActiveTab('dcf');
    setDcfSubTab('assumptions');
    const caveat = bundle.warnings.length ? ` (${bundle.warnings.length} catatan perlu dibaca)` : '';
    showToast(`Model DCF & LBO ${bundle.emiten.code} terkalibrasi dari laporan keuangan riil${caveat}.`);
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      // ExcelJS is ~940 KB and only needed on this click, so it is pulled in on
      // demand rather than shipped in the initial bundle.
      const { exportFinancialModelToExcel } = await import('./models/excelExporter');
      await exportFinancialModelToExcel(dcfAssumptions, dcfSummary, lboAssumptions, lboSummary);
      showToast('Successfully generated & downloaded Wall Street Excel model (.xlsx)!');
    } catch (err) {
      console.error(err);
      showToast('Error exporting to Excel. Please check browser console.');
    } finally {
      setIsExporting(false);
    }
  };

  const currentPreset = DEAL_PRESETS.find(p => p.id === selectedPresetId);

  // Loaded once and shared: the landing hero draws the real IHSG line, and the
  // terminal reuses the very same database object rather than parsing it twice.
  const market = useMarketData(true);

  useEffect(() => {
    let alive = true;
    void fetchAuthState().then((state) => {
      if (!alive) return;
      setAccount(state.user);
      setAccountsExist(state.accountsExist);
      setServiceUp(state.serviceUp);
      setAuthChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Ctrl+K / Cmd+K opens the function menu from anywhere. Bound at the window
  // so it works while focus is inside a table, a chart or a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setMenuOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSignOut = async () => {
    await logOut().catch(() => undefined);
    setAccount(null);
    showToast('Anda sudah keluar.');
  };

  // Presets carry the price that was current when they were written. Once the
  // market database is loaded, re-stamp the selected preset with the live close
  // so the terminal never shows a stale "current market price" beside a live
  // one. Skipped once a specific emiten has been calibrated in, because that
  // bundle already carries its own live price.
  useEffect(() => {
    if (!market.db || loadedReport) return;
    const code = selectedPresetId.toUpperCase();
    const quote = market.db.daily.get(code);
    const emiten = market.db.byCode.get(code);
    if (!quote || !(quote.close > 0)) return;

    const sharesBn = emiten?.listedShares ? emiten.listedShares / 1e9 : 0;
    setDcfAssumptions((prev) =>
      prev.currentSharePrice === quote.close && (!sharesBn || prev.sharesOutstanding === sharesBn)
        ? prev
        : { ...prev, currentSharePrice: quote.close, sharesOutstanding: sharesBn || prev.sharesOutstanding }
    );
  }, [market.db, selectedPresetId, loadedReport]);

  const applyDestination = (
    destination: 'market' | 'screener' | 'watchlist' | 'emiten' | 'chat' | 'dcf' | 'analytics'
  ) => {
    setShowLanding(false);
    if (destination === 'dcf') {
      setActiveTab('dcf');
      return;
    }
    if (destination === 'analytics') {
      setActiveTab('analytics');
      return;
    }
    setActiveTab('market');
    setMarketSubTab(destination === 'market' ? 'overview' : destination);
  };

  /**
   * Entering the terminal goes behind a curtain wipe rather than swapping in
   * place. The route change itself is deferred into the transition's `onCover`
   * so it lands while the screen is hidden — swapping early shows the terminal
   * assembling behind a translucent panel, which looks broken.
   */
  const enterTerminal = (
    destination: 'market' | 'screener' | 'watchlist' | 'emiten' | 'chat' | 'dcf' | 'analytics'
  ) => {
    setCurtainTo(() => () => applyDestination(destination));
  };

  /** Jump from any analytics table straight to that emiten's detail panel. */
  const openEmitenDetail = (code: string) => {
    setPendingEmiten(code);
    setLastEmiten(code);
    setActiveTab('market');
    setMarketSubTab('emiten');
  };

  /**
   * Jump to a function by its mnemonic.
   *
   * One path for the menu panel, the command line and the mobile tab bar, so a
   * screen cannot be reachable one way and not another.
   */
  const runFunction = (fn: TerminalFunction) => {
    setMenuOpen(false);
    setShowLanding(false);
    setActiveTab(fn.area);
    if (fn.area === 'market' && fn.sub) setMarketSubTab(fn.sub as MarketSubTab);
    if (fn.area === 'analytics' && fn.sub) setAnalyticsSubTab(fn.sub as AnalyticsSubTab);
  };

  /** The function currently on screen, for the command bar's left-hand label. */
  const activeFunction: TerminalFunction | null =
    TERMINAL_FUNCTIONS.find((f) => {
      if (f.area !== activeTab) return false;
      if (f.area === 'market') return f.sub === marketSubTab;
      if (f.area === 'analytics') return f.sub === analyticsSubTab;
      return true;
    }) ?? null;

  /** Calibrate an emiten into the DCF/LBO engines from anywhere in the app. */
  const modelEmitenByCode = (code: string) => {
    if (!market.db || !market.fundamentals) return;
    const emiten = market.db.byCode.get(code);
    if (!emiten) return;
    const bundle = buildEmitenModel(emiten, market.db, market.fundamentals);
    if (bundle) handleApplyEmitenModel(bundle);
  };

  const authModal = (
    <AuthModal
      open={authOpen}
      isFirstRun={serviceUp && !accountsExist}
      dismissible={!serviceUp || accountsExist || !!account}
      onClose={() => setAuthOpen(false)}
      onAuthenticated={(user) => {
        setAccount(user);
        setAccountsExist(true);
        setAuthOpen(false);
        showToast(
          user.role === 'administrator'
            ? `Akun administrator dibuat. Alert harian akan dikirim ke ${user.email}.`
            : `Selamat datang, ${user.name}.`
        );
      }}
    />
  );

  const curtain = curtainTo ? (
    <CurtainTransition
      onCover={() => curtainTo()}
      onDone={() => setCurtainTo(null)}
    />
  ) : null;

  if (showLanding) {
    return (
      <>
        {authModal}
        {curtain}
        <LandingPage
          db={market.db}
          indices={market.indices}
          loading={market.loading}
          account={account}
          serviceUp={serviceUp}
          authChecked={authChecked}
          onOpenAuth={() => setAuthOpen(true)}
          onEnter={enterTerminal}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {authModal}
      {curtain}

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-600 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-emerald-400/40 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedPresetId={selectedPresetId}
        onSelectPreset={handleSelectPreset}
        onExportExcel={handleExportExcel}
        onOpenChat={() => {
          setActiveTab('market');
          setMarketSubTab('chat');
        }}
        onHome={() => setShowLanding(true)}
        account={account}
        serviceUp={serviceUp}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={handleSignOut}
        isExporting={isExporting}
        dcfTargetPrice={dcfSummary.impliedSharePriceGordon}
        lboIrr={lboSummary.sponsorIRR}
        currency={dcfAssumptions.currency}
      />

      <MenuPanel
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onPick={runFunction}
        activeCode={activeFunction?.code ?? null}
      />

      <FunctionBar
        active={activeFunction}
        onOpenMenu={() => setMenuOpen(true)}
        onRun={runFunction}
      />

      <LiveStatusBar
        db={market.db}
        onDataRefreshed={market.reload}
        loadedAt={market.loadedAt}
        autoRefresh={market.autoRefresh}
        setAutoRefresh={market.setAutoRefresh}
        refreshing={market.refreshing}
      />

      {activeTab !== 'market' && activeTab !== 'analytics' && (
        <div className="bg-slate-900 border-b border-slate-800/80 px-4 sm:px-6 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="font-semibold text-slate-500 uppercase tracking-wide">Emiten aktif</span>
            <span className="text-blue-400 font-bold">
              {loadedReport ? loadedReport.companyName : currentPreset?.name}
            </span>
            <span className="text-slate-700">·</span>
            <span className="text-slate-400">
              {loadedReport
                ? `Terkalibrasi dari laporan keuangan (${loadedReport.currency}${loadedReport.units === 'billions' ? 'miliar' : loadedReport.units})`
                : currentPreset?.description}
            </span>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 pb-24 lg:pb-8 flex-1 w-full space-y-5 sm:space-y-6">
        
        {/* 0. IDX MARKET WORKSPACE */}
        {activeTab === 'market' && (
          <MarketWorkspace
            market={market}
            subTab={marketSubTab}
            onSubTabChange={setMarketSubTab}
            onApplyModel={handleApplyEmitenModel}
            focusEmiten={pendingEmiten}
            onFocusHandled={() => setPendingEmiten(null)}
          />
        )}

        {/* 0b. BLOOMBERG-STYLE ANALYTICS */}
        {activeTab === 'analytics' && (
          <AnalyticsWorkspace
            market={market}
            subTab={analyticsSubTab}
            onSubTabChange={setAnalyticsSubTab}
            onSelectEmiten={openEmitenDetail}
            onModelEmiten={modelEmitenByCode}
            focusEmiten={lastEmiten}
          />
        )}

        {/* 2. DCF MODEL WORKSPACE */}
        {activeTab === 'dcf' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                title="Target Price (Gordon Growth)"
                value={formatCurrency(dcfSummary.impliedSharePriceGordon, dcfAssumptions.currency, 2)}
                subValue={`Current Market: ${formatCurrency(dcfAssumptions.currentSharePrice, dcfAssumptions.currency, 2)}`}
                badge={{
                  text: `${dcfSummary.upsideGordonPercent >= 0 ? '+' : ''}${formatPercent(dcfSummary.upsideGordonPercent, 1)} Upside`,
                  type: dcfSummary.upsideGordonPercent >= 0 ? 'positive' : 'negative',
                }}
                icon={TrendingUp}
                variant="primary"
              />

              <MetricCard
                title="Target Price (Exit Multiple)"
                value={formatCurrency(dcfSummary.impliedSharePriceMultiple, dcfAssumptions.currency, 2)}
                subValue={`Based on ${dcfAssumptions.exitMultiple.toFixed(1)}x EV/EBITDA`}
                badge={{
                  text: `${dcfSummary.upsideMultiplePercent >= 0 ? '+' : ''}${formatPercent(dcfSummary.upsideMultiplePercent, 1)} Upside`,
                  type: dcfSummary.upsideMultiplePercent >= 0 ? 'positive' : 'negative',
                }}
                icon={Award}
                variant="primary"
              />

              <MetricCard
                title="Implied Enterprise Value"
                value={formatCurrency(dcfSummary.evGordonGrowth, dcfAssumptions.currency, 1)}
                subValue={`Equity Value: ${formatCurrency(dcfSummary.equityValueGordonGrowth, dcfAssumptions.currency, 1)}`}
                badge={{
                  text: `PV FCF: ${formatCurrency(dcfSummary.pvDiscreteCashFlows, dcfAssumptions.currency, 1)}`,
                  type: 'info',
                }}
                icon={DollarSign}
              />

              <MetricCard
                title="Cost of Capital (WACC)"
                value={formatPercent(dcfSummary.wacc.wacc, 2)}
                subValue={`Cost of Equity: ${formatPercent(dcfSummary.wacc.costOfEquity, 1)} | After-tax Kd: ${formatPercent(dcfSummary.wacc.afterTaxCostOfDebt, 1)}`}
                badge={{
                  text: `Ke Weight ${formatPercent(dcfSummary.wacc.equityWeight, 0)}`,
                  type: 'neutral',
                }}
                icon={Sparkles}
              />
            </div>

            <Segmented
              options={[
                { id: 'assumptions', label: '1. Valuation Assumptions & WACC', shortLabel: '1. Asumsi', icon: Sliders },
                { id: 'cashflows', label: '2. UFCF Projections Schedule', shortLabel: '2. UFCF', icon: Table },
                { id: 'valuation', label: '3. EV to Equity Value Bridge', shortLabel: '3. Bridge', icon: DollarSign },
                { id: 'sensitivity', label: '4. Sensitivity Heatmap & Charts', shortLabel: '4. Sensitivitas', icon: BarChart3 },
              ]}
              value={dcfSubTab}
              onChange={setDcfSubTab}
              ariaLabel="Bagian model DCF"
              activeClass="bg-blue-600 text-white shadow-md shadow-blue-900/40"
            />

            <DcfDiagnostics summary={dcfSummary} />

            {dcfSubTab === 'assumptions' && (
              <div className="space-y-6">
                <WaccCalculatorComponent wacc={dcfSummary.wacc} taxRate={dcfAssumptions.taxRate} />
                <DcfAssumptionsComponent assumptions={dcfAssumptions} onChange={setDcfAssumptions} />
              </div>
            )}

            {dcfSubTab === 'cashflows' && (
              <CashFlowTable cashFlows={dcfSummary.cashFlows} currency={dcfAssumptions.currency} />
            )}

            {dcfSubTab === 'valuation' && (
              <ValuationBridge assumptions={dcfAssumptions} summary={dcfSummary} />
            )}

            {dcfSubTab === 'sensitivity' && (
              <DcfSensitivity assumptions={dcfAssumptions} summary={dcfSummary} />
            )}

          </div>
        )}

        {/* 3. LBO MODEL WORKSPACE */}
        {activeTab === 'lbo' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <MetricCard
                title="Sponsor IRR"
                value={formatPercent(lboSummary.sponsorIRR, 1)}
                subValue={`Hold: ${lboAssumptions.holdPeriodYears} Years | Exit: Year ${lboSummary.exitYear}`}
                badge={{
                  text: lboSummary.sponsorIRR >= 0.20 ? 'Target Exceeded (>20%)' : 'Below 20% Hurdle',
                  type: lboSummary.sponsorIRR >= 0.20 ? 'positive' : 'warning',
                }}
                icon={Award}
                variant="success"
              />

              <MetricCard
                title="Multiple on Invested Capital (MoIC)"
                value={formatMultiple(lboSummary.sponsorMoIC, 2)}
                subValue={`Initial Equity: ${formatCurrency(lboSummary.initialSponsorEquity, lboAssumptions.currency, 1)}`}
                badge={{
                  text: `Exit Equity: ${formatCurrency(lboSummary.exitEquityValue, lboAssumptions.currency, 1)}`,
                  type: 'info',
                }}
                icon={TrendingUp}
                variant="success"
              />

              <MetricCard
                title="Total Uses / Transaction Value"
                value={formatCurrency(lboSummary.sourcesAndUses.totalUses, lboAssumptions.currency, 1)}
                subValue={`Entry EV: ${formatCurrency(lboSummary.sourcesAndUses.enterpriseValue, lboAssumptions.currency, 1)} (${lboAssumptions.entryEvEbitdaMultiple.toFixed(1)}x EBITDA)`}
                badge={{
                  text: `Sponsor Eq: ${formatPercent(lboSummary.sourcesAndUses.sponsorEquityPercent, 1)}`,
                  type: 'neutral',
                }}
                icon={DollarSign}
              />

              <MetricCard
                title="Total Leverage at Entry"
                value={formatMultiple(lboSummary.sourcesAndUses.totalDebtMultiple, 2)}
                subValue={`Senior: ${lboAssumptions.seniorDebtMultiple.toFixed(2)}x | Sub: ${lboAssumptions.subDebtMultiple.toFixed(2)}x`}
                badge={{
                  text: `Debt: ${formatCurrency(lboSummary.sourcesAndUses.totalDebtRaised, lboAssumptions.currency, 1)}`,
                  type: 'neutral',
                }}
                icon={Layers}
              />
            </div>

            <Segmented
              options={[
                { id: 'structure', label: '1. Transaction Structure & Sources/Uses', shortLabel: '1. Struktur', icon: Sliders },
                { id: 'waterfall', label: '2. Debt Schedule Waterfall', shortLabel: '2. Utang', icon: Table },
                { id: 'returns', label: '3. Exit Returns & Value Creation', shortLabel: '3. Return', icon: Award },
                { id: 'sensitivity', label: '4. Returns Sensitivity Matrix', shortLabel: '4. Sensitivitas', icon: BarChart3 },
              ]}
              value={lboSubTab}
              onChange={setLboSubTab}
              ariaLabel="Bagian model LBO"
              activeClass="bg-indigo-600 text-white shadow-md shadow-indigo-900/40"
            />

            {lboSubTab === 'structure' && (
              <div className="space-y-6">
                <SourcesAndUsesComponent
                  sourcesAndUses={lboSummary.sourcesAndUses}
                  currency={lboAssumptions.currency}
                />
                <LboAssumptionsComponent
                  assumptions={lboAssumptions}
                  onChange={setLboAssumptions}
                />
              </div>
            )}

            {lboSubTab === 'waterfall' && (
              <DebtWaterfallComponent
                schedules={lboSummary.schedules}
                sourcesAndUses={lboSummary.sourcesAndUses}
                currency={lboAssumptions.currency}
              />
            )}

            {lboSubTab === 'returns' && (
              <ReturnsSummaryComponent
                summary={lboSummary}
                currency={lboAssumptions.currency}
              />
            )}

            {lboSubTab === 'sensitivity' && (
              <LboSensitivity
                assumptions={lboAssumptions}
                summary={lboSummary}
              />
            )}

          </div>
        )}

      </main>

      <MobileTabBar activeTab={activeTab} setActiveTab={setActiveTab} />

      <footer className="bg-slate-900 border-t border-slate-800 px-4 sm:px-6 py-4 mt-auto pb-20 lg:pb-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">ValuationPro Financial Suite</span>
            <span>•</span>
            <span>DCF & LBO Financial Engine with Bilingual Financial Statement Parser</span>
          </div>
          <div>Wall Street & Private Equity Valuation Engine</div>
        </div>
      </footer>
    </div>
  );
}