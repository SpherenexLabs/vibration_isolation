  import { useState, useEffect } from "react";
  import {
    BarChart, LineChart, XAxis, YAxis, Tooltip,
    Bar, Line, CartesianGrid, ResponsiveContainer, RadarChart,
    PolarGrid, PolarAngleAxis, Radar,
  } from "recharts";
  import Papa from 'papaparse';
  import { jsPDF } from 'jspdf';
  import autoTable from 'jspdf-autotable';
  import './Dashboard.css';
  import sphereNextLogo from '../assets/Logo1.png';

  const SHEET_URL =
    "https://docs.google.com/spreadsheets/d/12phtu243TTlKb5DGO3gztxmWZfp_9qjTzxJ5qYRCqEA/export?format=csv&gid=0";

  const SENSOR_COLORS = {
    Temp:      '#FF6B35',
    RPM:       '#00ff41',
    Sound:     '#FFD700',
    Vibration: '#00BFFF',
    Current:   '#ff0080',
  };

  // ── ML helpers (pure functions, no hooks) ─────────────────────────────────────

  const mlAnomaly = (col, data, latestEntry, threshold = 2.0) => {
    const vals = data.map(r => r[col]).filter(v => typeof v === 'number');
    if (vals.length < 5) return { isAnomaly: false, zscore: 0, severity: 'normal', mean: 0, std: 0 };
    const mean  = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std   = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const latest = typeof latestEntry?.[col] === 'number' ? latestEntry[col] : mean;
    const z     = std > 0 ? Math.abs((latest - mean) / std) : 0;
    let severity = 'normal';
    if (z > 3.5)       severity = 'critical';
    else if (z > 2.5)  severity = 'warning';
    else if (z > 1.5)  severity = 'watch';
    return { isAnomaly: z > threshold, zscore: +z.toFixed(2), severity, mean: +mean.toFixed(3), std: +std.toFixed(3) };
  };

  const mlTrend = (col, data, win = 15) => {
    const vals = data.map(r => r[col]).filter(v => typeof v === 'number');
    if (vals.length < win + 3) return { direction: 'stable', changePct: 0, rate: 0 };
    const recent = vals.slice(-win);
    const prev   = vals.slice(-win * 2, -win);
    if (!prev.length) return { direction: 'stable', changePct: 0, rate: 0 };
    const rAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const pAvg = prev.reduce((s, v) => s + v, 0) / prev.length;
    const pct  = pAvg !== 0 ? ((rAvg - pAvg) / Math.abs(pAvg)) * 100 : 0;
    const direction = pct > 3 ? 'rising' : pct < -3 ? 'falling' : 'stable';
    const rate = (rAvg - pAvg) / win;
    return { direction, changePct: +pct.toFixed(1), rate: +rate.toFixed(4) };
  };

  const mlHealthScore = (data, latestEntry) => {
    if (!data.length || !latestEntry) return 100;
    const cols    = ['Vibration', 'Temp', 'Current', 'Sound', 'RPM'];
    const weights = { Vibration: 0.40, Temp: 0.25, Current: 0.20, Sound: 0.10, RPM: 0.05 };
    let penalty = 0;
    cols.forEach(col => {
      const { zscore } = mlAnomaly(col, data, latestEntry);
      const w = weights[col] ?? 0.1;
      if (zscore > 3.5)      penalty += 35 * w;
      else if (zscore > 2.5) penalty += 22 * w;
      else if (zscore > 1.5) penalty += 10 * w;
    });
    // Trend penalties
    const vt = mlTrend('Vibration', data);
    const tt = mlTrend('Temp', data);
    if (vt.direction === 'rising') penalty += 8;
    if (tt.direction === 'rising') penalty += 5;
    return Math.max(0, Math.min(100, Math.round(100 - penalty)));
  };

  const mlRecommendations = (data, latestEntry, healthScore) => {
    const recs = [];
    if (!data.length || !latestEntry) return recs;

    const vib  = mlAnomaly('Vibration', data, latestEntry);
    const temp = mlAnomaly('Temp',      data, latestEntry);
    const curr = mlAnomaly('Current',   data, latestEntry);
    const snd  = mlAnomaly('Sound',     data, latestEntry);
    const vt   = mlTrend('Vibration',  data);
    const tt   = mlTrend('Temp',       data);
    const ct   = mlTrend('Current',    data);
    const lv   = latestEntry?.Vibration ?? 0;
    const lt   = latestEntry?.Temp      ?? 0;
    const lr   = latestEntry?.RPM       ?? 0;
    const lc   = latestEntry?.Current   ?? 0;

    // Critical anomalies
    if (vib.severity === 'critical')
      recs.push({ priority: 0, type: 'critical', icon: '🚨', title: 'Critical Vibration Anomaly',
        desc: `Z-score ${vib.zscore} — Immediate inspection required. Check isolator mounts and balance.` });
    if (curr.severity === 'critical')
      recs.push({ priority: 0, type: 'critical', icon: '⚡', title: 'Critical Current Spike',
        desc: `Z-score ${curr.zscore} — Possible motor overload. Reduce load or inspect wiring.` });

    // Warnings
    if (vib.severity === 'warning')
      recs.push({ priority: 1, type: 'warning', icon: '⚠️', title: 'Vibration Above Normal',
        desc: `Z-score ${vib.zscore} — Tighten mounting bolts. Check for loose components.` });
    if (temp.severity === 'warning' || temp.severity === 'critical')
      recs.push({ priority: 1, type: 'warning', icon: '🌡️', title: 'Temperature Elevated',
        desc: `${lt.toFixed(1)} °C, Z-score ${temp.zscore} — Verify cooling, reduce duty cycle.` });
    if (snd.severity === 'warning')
      recs.push({ priority: 1, type: 'warning', icon: '🔊', title: 'Unusual Sound Level',
        desc: `Z-score ${snd.zscore} — Possible bearing wear or resonance. Schedule inspection.` });

    // Trend-based suggestions
    if (vt.direction === 'rising')
      recs.push({ priority: 2, type: 'info', icon: '📈', title: `Vibration Trending Up (+${vt.changePct}%)`,
        desc: 'Gradual increase detected. Re-check isolation pad condition and RPM setpoint.' });
    if (vt.direction === 'falling')
      recs.push({ priority: 3, type: 'good', icon: '📉', title: `Vibration Reducing (${vt.changePct}%)`,
        desc: 'System improving. Continue monitoring.' });
    if (tt.direction === 'rising')
      recs.push({ priority: 2, type: 'info', icon: '🌡️', title: `Temp Rising (+${tt.changePct}%)`,
        desc: 'Thermal creep detected. Ensure ventilation is unobstructed.' });
    if (ct.direction === 'rising')
      recs.push({ priority: 2, type: 'info', icon: '⚡', title: `Current Trending Up (+${ct.changePct}%)`,
        desc: 'Motor draw increasing. Check for mechanical friction or load increase.' });

    // RPM/idle suggestions
    if (lr === 0 && lv > 0.05)
      recs.push({ priority: 2, type: 'info', icon: '🔄', title: 'Vibration at Idle',
        desc: 'Motor is idle (RPM=0) but vibration exists. Possible external vibration source or sensor offset.' });
    if (lr === 0 && lt > 35)
      recs.push({ priority: 2, type: 'info', icon: '🔄', title: 'Warm at Idle',
        desc: `Temp ${lt.toFixed(1)} °C with RPM=0. Residual heat — allow cool-down before next run.` });

    // Control suggestions based on combined state
    if (lv > 0.1 && lr > 0)
      recs.push({ priority: 2, type: 'info', icon: '⚙️', title: 'Control: Reduce RPM',
        desc: `High vibration at current RPM. Try reducing speed by 10–15% to find stable operating point.` });
    if (lt > 50)
      recs.push({ priority: 1, type: 'warning', icon: '🌡️', title: 'Control: Enable Cooling',
        desc: 'Temperature exceeds 50 °C. Activate auxiliary cooling or reduce duty cycle.' });
    if (lv < 0.02 && lr > 0 && lt < 45)
      recs.push({ priority: 3, type: 'good', icon: '✅', title: 'Control: Optimal Operating Point',
        desc: 'Low vibration, normal temperature. Current settings are near optimal.' });

    // Overall health
    if (healthScore >= 90 && recs.filter(r => r.type !== 'good').length === 0)
      recs.push({ priority: 4, type: 'good', icon: '✅', title: 'System Healthy',
        desc: 'All sensors within normal range. No action required.' });
    else if (healthScore < 60)
      recs.push({ priority: 0, type: 'critical', icon: '🚨', title: 'System Needs Attention',
        desc: `Health score ${healthScore}/100. Multiple anomalies detected — schedule maintenance.` });

    return recs.sort((a, b) => a.priority - b.priority);
  };

  const mlMaintenanceForecast = (data, latestEntry) => {
    const vt = mlTrend('Vibration', data);
    const tt = mlTrend('Temp',      data);
    const lv = latestEntry?.Vibration ?? 0;
    const lt = latestEntry?.Temp      ?? 0;

    const VIBE_CRITICAL = 0.5;
    const TEMP_CRITICAL = 70;

    let forecastSamples = null;
    let reason = '';

    if (vt.direction === 'rising' && vt.rate > 0) {
      const samplesLeft = Math.max(0, (VIBE_CRITICAL - lv) / vt.rate);
      if (forecastSamples === null || samplesLeft < forecastSamples) {
        forecastSamples = samplesLeft;
        reason = 'vibration threshold';
      }
    }
    if (tt.direction === 'rising' && tt.rate > 0) {
      const samplesLeft = Math.max(0, (TEMP_CRITICAL - lt) / tt.rate);
      if (forecastSamples === null || samplesLeft < forecastSamples) {
        forecastSamples = samplesLeft;
        reason = 'temperature threshold';
      }
    }

    if (forecastSamples === null) return { label: 'No intervention predicted', urgency: 'good', hours: null };

    const hours = (forecastSamples / 3600).toFixed(1); // assuming 1 Hz
    let urgency = 'good';
    if (forecastSamples < 3600)        urgency = 'critical'; // < 1 h
    else if (forecastSamples < 86400)  urgency = 'warning';  // < 24 h

    return {
      label: `~${hours} h until ${reason}`,
      urgency,
      hours: parseFloat(hours),
    };
  };

  // ── colour helpers ────────────────────────────────────────────────────────────
  const severityColor = s =>
    ({ critical: '#e74c3c', warning: '#f39c12', watch: '#f1c40f', normal: '#27ae60' })[s] ?? '#27ae60';
  const typeColor = t =>
    ({ critical: '#e74c3c', warning: '#f39c12', info: '#3498db', good: '#27ae60' })[t] ?? '#95a5a6';
  const trendArrow = d => ({ rising: '↑', falling: '↓', stable: '→' })[d] ?? '→';
  const trendColor = d => ({ rising: '#e74c3c', falling: '#3498db', stable: '#27ae60' })[d] ?? '#27ae60';
  const healthColor = s => s >= 85 ? '#27ae60' : s >= 60 ? '#f39c12' : '#e74c3c';
  const healthLabel = s => s >= 85 ? 'HEALTHY' : s >= 60 ? 'CAUTION' : 'AT RISK';

  // ─────────────────────────────────────────────────────────────────────────────

  const Dashboard = () => {
    const [data, setData]                   = useState([]);
    const [loading, setLoading]             = useState(true);
    const [error, setError]                 = useState(null);
    const [latestEntry, setLatestEntry]     = useState(null);
    const [lastUpdated, setLastUpdated]     = useState(new Date());
    const [rmsMode, setRmsMode]             = useState('standard');
    const [showDebugInfo, setShowDebugInfo] = useState(false);
    const [showML, setShowML]               = useState(true);

    const fetchData = async () => {
      try {
        const response = await fetch(SHEET_URL);
        const text     = await response.text();
        const result   = Papa.parse(text, {
          header: true, dynamicTyping: true,
          skipEmptyLines: true, delimitersToGuess: [',', '\t', '|', ';'],
        });
        if (result.data?.length > 0) {
          setData(result.data);
          setLatestEntry(result.data[result.data.length - 1]);
        }
        setLoading(false);
        setLastUpdated(new Date());
      } catch (err) {
        setError("Failed to fetch data. Please try again later.");
        setLoading(false);
      }
    };

    useEffect(() => { fetchData(); }, []);
    useEffect(() => {
      const id = setInterval(fetchData, 1000);
      return () => clearInterval(id);
    }, []);

    if (loading)           return <div className="loading">Loading data...</div>;
    if (error)             return <div className="error">{error}</div>;
    if (data.length === 0) return <div className="empty">No data available</div>;
    if (!latestEntry)      return <div className="empty">No latest entry found</div>;

    // ── basic helpers ──────────────────────────────────────────────────────────
    const headers          = Object.keys(data[0]);
    const numericalColumns = headers.filter(h => typeof data[0][h] === 'number');

    const calcStdRMS = (col, ds = data) => {
      const v = ds.map(r => r[col]).filter(n => typeof n === 'number');
      if (!v.length) return '0.000';
      return Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length).toFixed(3);
    };
    const calcACRMS = (col, ds = data) => {
      const v = ds.map(r => r[col]).filter(n => typeof n === 'number');
      if (!v.length) return '0.000';
      const m = v.reduce((s, x) => s + x, 0) / v.length;
      return Math.sqrt(v.map(x => x - m).reduce((s, x) => s + x * x, 0) / v.length).toFixed(3);
    };
    const calcRMS = (col, ds = data) =>
      rmsMode === 'ac-coupled' ? calcACRMS(col, ds) : calcStdRMS(col, ds);

    const getStats = (col, ds = data) => {
      const v = ds.map(r => r[col]).filter(n => typeof n === 'number');
      if (!v.length) return null;
      const mn = Math.min(...v), mx = Math.max(...v);
      const m  = v.reduce((s, x) => s + x, 0) / v.length;
      const sr = Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
      const ar = Math.sqrt(v.map(x => x - m).reduce((s, x) => s + x * x, 0) / v.length);
      return {
        min: mn.toFixed(3), max: mx.toFixed(3), mean: m.toFixed(3),
        standardRMS: sr.toFixed(3), acRMS: ar.toFixed(3),
        peakToPeak: (mx - mn).toFixed(3), crestFactor: sr > 0 ? (mx / sr).toFixed(2) : '0.00',
      };
    };

    const getRange = (col, ds) => {
      const v = ds.map(r => r[col]).filter(n => typeof n === 'number' && !isNaN(n));
      if (!v.length) return ['auto', 'auto'];
      const mn = Math.min(...v), mx = Math.max(...v);
      return mn === mx ? [mn - 0.1, mx + 0.1] : [mn, mx];
    };

    const getImageBase64 = src =>
      new Promise((res, rej) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => {
          const c = document.createElement('canvas'); const ctx = c.getContext('2d');
          c.width = img.width; c.height = img.height;
          ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0); res(c.toDataURL('image/png', 0.8));
        };
        img.onerror = rej; img.src = src;
      });

    // ── latest sensor values ───────────────────────────────────────────────────
    const latestVibration = latestEntry?.Vibration ?? 0;
    const latestTemp      = latestEntry?.Temp      ?? 0;
    const latestRPM       = latestEntry?.RPM       ?? 0;
    const latestSound     = latestEntry?.Sound     ?? 0;
    const latestCurrent   = latestEntry?.Current   ?? 0;
    const latestTime      = latestEntry?.Time      ?? '';
    const vibrationRMS    = parseFloat(calcRMS('Vibration'));
    const vibrationStats  = getStats('Vibration');

    // ── ML computations ────────────────────────────────────────────────────────
    const ML_COLS = ['Temp', 'RPM', 'Sound', 'Vibration', 'Current'];

    const anomalies = Object.fromEntries(
      ML_COLS.map(c => [c, mlAnomaly(c, data, latestEntry)])
    );
    const trends = Object.fromEntries(
      ML_COLS.map(c => [c, mlTrend(c, data)])
    );
    const healthScore   = mlHealthScore(data, latestEntry);
    const recommendations = mlRecommendations(data, latestEntry, healthScore);
    const maintenance   = mlMaintenanceForecast(data, latestEntry);

    // Radar chart data for ML panel
    const radarData = ML_COLS.map(col => {
      const z    = anomalies[col]?.zscore ?? 0;
      const norm = Math.max(0, 100 - Math.min(z * 25, 100));
      return { sensor: col, score: +norm.toFixed(0) };
    });

    // Vibration distribution
    const freqMap = {};
    data.forEach(row => {
      if (typeof row.Vibration === 'number') {
        const k = row.Vibration.toFixed(3);
        freqMap[k] = (freqMap[k] || 0) + 1;
      }
    });
    const freqChartData = Object.entries(freqMap)
      .map(([val, frequency]) => ({ value: val, frequency }))
      .sort((a, b) => Number(a.value) - Number(b.value));

    const timeSeriesData = data.map((item, i) => ({ time: i, ...item }));

    // ── PDF ────────────────────────────────────────────────────────────────────
    const generatePDFReport = async () => {
      try {
        const doc = new jsPDF();
        if (typeof doc.autoTable !== 'function' && typeof autoTable === 'function')
          doc.autoTable = opts => autoTable(doc, opts);

        const pw = doc.internal.pageSize.width, mg = 20;
        let y = 20;

        try {
          doc.addImage(await getImageBase64(sphereNextLogo), 'PNG', mg, y, 50, 25);
          y += 30;
        } catch { y += 10; }

        doc.setFontSize(16); doc.setTextColor(255, 102, 0);
        doc.text('Vibration Isolation Dashboard Report', mg, y); y += 15;
        doc.setFontSize(11); doc.setTextColor(100, 100, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, mg, y);
        doc.text(`Last Update: ${lastUpdated.toLocaleString()}`, mg, y + 7);
        doc.text(`RMS Mode: ${rmsMode.toUpperCase()} | Health Score: ${healthScore}/100 (${healthLabel(healthScore)})`, mg, y + 14);
        y += 32; doc.setLineWidth(0.5); doc.setDrawColor(200, 200, 200);
        doc.line(mg, y, pw - mg, y); y += 10;

        // Sensor summary
        doc.setFontSize(14); doc.setTextColor(40, 40, 40);
        doc.text('Sensor Summary', mg, y); y += 8;
        doc.autoTable({
          startY: y,
          head: [['Parameter', 'Latest Value', 'RMS', 'Z-Score', 'Status']],
          body: ML_COLS.map(c => [
            c,
            typeof latestEntry[c] === 'number' ? latestEntry[c].toFixed(3) : latestEntry[c] ?? '—',
            calcRMS(c),
            anomalies[c]?.zscore ?? '—',
            anomalies[c]?.severity?.toUpperCase() ?? '—',
          ]),
          theme: 'striped',
          headStyles: { fillColor: [255, 102, 0], textColor: 255, fontStyle: 'bold' },
          bodyStyles: { textColor: 50 },
          margin: { left: mg, right: mg }, styles: { fontSize: 9, cellPadding: 3 },
        });
        y = doc.lastAutoTable.finalY + 14;

        // ML recommendations
        if (y > 200) { doc.addPage(); y = 20; }
        doc.setFontSize(14); doc.setTextColor(40, 40, 40);
        doc.text('ML Recommendations', mg, y); y += 8;
        doc.autoTable({
          startY: y,
          head: [['Priority', 'Title', 'Description']],
          body: recommendations.map((r, i) => [i + 1, r.title, r.desc]),
          theme: 'striped',
          headStyles: { fillColor: [52, 152, 219], textColor: 255, fontStyle: 'bold' },
          bodyStyles: { textColor: 50 },
          margin: { left: mg, right: mg }, styles: { fontSize: 8, cellPadding: 3 },
          columnStyles: { 2: { cellWidth: 100 } },
        });
        y = doc.lastAutoTable.finalY + 14;

        // Vibration stats
        if (vibrationStats) {
          if (y > 200) { doc.addPage(); y = 20; }
          doc.setFontSize(14); doc.setTextColor(40, 40, 40);
          doc.text('Vibration Signal Statistics', mg, y); y += 8;
          doc.autoTable({
            startY: y,
            head: [['Metric', 'Value']],
            body: [
              ['Standard RMS', vibrationStats.standardRMS],
              ['AC-Coupled RMS', vibrationStats.acRMS],
              ['Mean (DC)', vibrationStats.mean],
              ['Peak-to-Peak', vibrationStats.peakToPeak],
              ['Min / Max', `${vibrationStats.min} / ${vibrationStats.max}`],
              ['Crest Factor', vibrationStats.crestFactor],
            ],
            theme: 'striped',
            headStyles: { fillColor: [0, 191, 255], textColor: 255, fontStyle: 'bold' },
            bodyStyles: { textColor: 50 },
            margin: { left: mg, right: mg }, styles: { fontSize: 9, cellPadding: 3 },
          });
        }

        const pages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i);
          doc.setFontSize(8); doc.setTextColor(100, 100, 100);
          doc.text('SphereNext Innovation Labs', mg, doc.internal.pageSize.height - 10);
          doc.text(`Page ${i} of ${pages}`, pw - mg - 30, doc.internal.pageSize.height - 10);
        }
        doc.save(`SphereNext_ML_Report_${new Date().toISOString().split('T')[0]}.pdf`);
      } catch (err) {
        console.error('PDF failed:', err);
        alert('Failed to generate PDF report.');
      }
    };

    // ── inline style helpers ───────────────────────────────────────────────────
    const card = (extra = {}) => ({
      backgroundColor: '#1a2332', border: '1px solid #2c3e50',
      borderRadius: '8px', padding: '16px', ...extra,
    });
    const pill = (color) => ({
      display: 'inline-block', padding: '2px 8px', borderRadius: '12px',
      backgroundColor: color + '22', color, fontSize: '11px', fontWeight: 'bold',
      border: `1px solid ${color}44`,
    });

    // ── render ─────────────────────────────────────────────────────────────────
    return (
      <div className="dashboard1">

        {/* ── Header ── */}
        <div className="header-section">
          <div className="header-content">
            <h1 className="main-title">
              <span className="title-icon">📊</span>
              Vibration Isolation Dashboard
            </h1>
            <div className="header-actions">
              <div className="analysis-controls">
                <select value={rmsMode} onChange={e => setRmsMode(e.target.value)}
                  style={{ backgroundColor: '#2c3e50', color: 'white', border: '1px solid #34495e',
                    padding: '8px 12px', borderRadius: '4px', marginRight: '8px' }}>
                  <option value="standard">Standard RMS</option>
                  <option value="ac-coupled">AC-Coupled RMS</option>
                </select>
                <button onClick={() => setShowML(!showML)} style={{
                  backgroundColor: showML ? '#8e44ad' : '#95a5a6', color: 'white',
                  border: 'none', padding: '8px 14px', borderRadius: '4px',
                  cursor: 'pointer', fontSize: '12px', marginRight: '8px' }}>
                  {showML ? '🤖 Hide ML' : '🤖 Show ML'}
                </button>
                <button onClick={() => setShowDebugInfo(!showDebugInfo)} style={{
                  backgroundColor: showDebugInfo ? '#3498db' : '#95a5a6', color: 'white',
                  border: 'none', padding: '8px 14px', borderRadius: '4px',
                  cursor: 'pointer', fontSize: '12px', marginRight: '8px' }}>
                  {showDebugInfo ? '📊 Hide Info' : '📊 Show Info'}
                </button>
              </div>
              <button className="generate-report-btn" onClick={generatePDFReport}>
                📄 Generate Report
              </button>
              <div className="status-indicator">
                <div className="status-dot"></div>
                <span>Live Recording</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Debug Panel ── */}
        {showDebugInfo && (
          <div style={{ backgroundColor: '#2c3e50', color: 'white', padding: '15px',
            margin: '10px 20px', borderRadius: '8px', fontSize: '12px', fontFamily: 'monospace' }}>
            <h3>📊 Sensor Information</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <h4>Latest Readings (Time: {latestTime}):</h4>
                <ul>
                  <li>Temperature : {latestTemp.toFixed(2)} °C</li>
                  <li>RPM         : {latestRPM}</li>
                  <li>Sound       : {latestSound.toFixed(3)}</li>
                  <li>Vibration   : {latestVibration.toFixed(3)}</li>
                  <li>Current     : {latestCurrent.toFixed(3)} A</li>
                </ul>
              </div>
              {vibrationStats && (
                <div>
                  <h4>Vibration Statistics:</h4>
                  <ul>
                    <li>Standard RMS   : {vibrationStats.standardRMS}</li>
                    <li>AC-Coupled RMS : {vibrationStats.acRMS}</li>
                    <li>Mean (DC)      : {vibrationStats.mean}</li>
                    <li>Range          : {vibrationStats.min} – {vibrationStats.max}</li>
                    <li>Peak-to-Peak   : {vibrationStats.peakToPeak}</li>
                    <li>Crest Factor   : {vibrationStats.crestFactor}</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="analysis-main-grid">

          {/* ── Sensor Waveforms ── */}
          <div className="waveform-section">
            <div className="section-title">Sensor Waveforms</div>
            <div className="waveform-grid">
              {numericalColumns.slice(0, 5).map((col, idx) => {
                const stats  = getStats(col);
                const color  = SENSOR_COLORS[col] || (idx % 2 === 0 ? '#00ff41' : '#ff0080');
                const anom   = anomalies[col];
                const trend  = trends[col];

                return (
                  <div key={col} className="waveform-container">
                    <div className="waveform-header">
                      <span className="signal-label">
                        {col}
                        {anom && anom.severity !== 'normal' && (
                          <span style={{ ...pill(severityColor(anom.severity)), marginLeft: '6px' }}>
                            {anom.severity.toUpperCase()}
                          </span>
                        )}
                      </span>
                      <div className="signal-metrics">
                        <span className="rms-value">{calcRMS(col)} rms</span>
                        {trend && (
                          <span style={{ color: trendColor(trend.direction), fontSize: '14px', marginLeft: '6px', fontWeight: 'bold' }}>
                            {trendArrow(trend.direction)}
                            <span style={{ fontSize: '10px' }}> {trend.changePct}%</span>
                          </span>
                        )}
                        {stats && (
                          <div style={{ fontSize: '10px', color: '#95a5a6' }}>
                            Peak: {stats.max} | Avg: {stats.mean}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="oscilloscope-display">
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={timeSeriesData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                          <defs>
                            <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor={color} stopOpacity={0.8} />
                              <stop offset="100%" stopColor={color} stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="1 1" stroke="#333" opacity={0.5} />
                          <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} domain={getRange(col, data)} />
                          <Line type="monotone" dataKey={col} stroke={color} strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Metrics Row ── */}
          <div className="metrics-analysis-row">

            <div className="current-values-panel">
              <div className="panel-header">Latest Sensor Values</div>
              <div className="values-grid">
                {headers.slice(0, 6).map(h => (
                  <div className="value-item" key={h}>
                    <div className="value-label">{h}</div>
                    <div className="value-display">
                      {typeof latestEntry[h] === 'number' ? latestEntry[h].toFixed(3) : latestEntry[h]}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="key-metrics-panel">
              <div className="panel-header">Sensor Readings (Latest)</div>
              <div className="metrics-display">
                <div className="metric-box input-metric">
                  <div className="metric-label">Temperature</div>
                  <div className="metric-value">{latestTemp.toFixed(2)}</div>
                  <div className="metric-unit">°C
                    <span style={{ color: trendColor(trends.Temp?.direction), marginLeft: '4px' }}>
                      {trendArrow(trends.Temp?.direction ?? 'stable')}
                    </span>
                  </div>
                </div>
                <div className="metric-box output-metric">
                  <div className="metric-label">RPM</div>
                  <div className="metric-value">{latestRPM}</div>
                  <div className="metric-unit">rpm
                    <span style={{ color: trendColor(trends.RPM?.direction), marginLeft: '4px' }}>
                      {trendArrow(trends.RPM?.direction ?? 'stable')}
                    </span>
                  </div>
                </div>
                <div className="metric-box transmissibility-metric">
                  <div className="metric-label">Vibration</div>
                  <div className="metric-value">{latestVibration.toFixed(3)}</div>
                  <div className="metric-unit">RMS: {vibrationRMS.toFixed(3)}
                    <span style={{ color: trendColor(trends.Vibration?.direction), marginLeft: '4px' }}>
                      {trendArrow(trends.Vibration?.direction ?? 'stable')}
                    </span>
                  </div>
                </div>
                <div className="metric-box efficiency-metric">
                  <div className="metric-label">Current</div>
                  <div className="metric-value">{latestCurrent.toFixed(3)}</div>
                  <div className="metric-unit">A
                    <span style={{ color: trendColor(trends.Current?.direction), marginLeft: '4px' }}>
                      {trendArrow(trends.Current?.direction ?? 'stable')}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="frequency-panel">
              <div className="panel-header">
                Vibration Distribution ({freqChartData.length} patterns)
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={freqChartData}>
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#00BFFF" />
                      <stop offset="100%" stopColor="#003d4d" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="1 1" stroke="#333" opacity={0.3} />
                  <XAxis dataKey="value" tick={{ fontSize: 8, fill: '#888' }} axisLine={false} tickLine={false}
                    interval={Math.max(0, Math.floor(freqChartData.length / 10) - 1)} />
                  <YAxis tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#000', border: '1px solid #333',
                    borderRadius: '4px', color: '#fff', fontSize: '12px' }} />
                  <Bar dataKey="frequency" fill="url(#barGradient)" stroke="#00BFFF" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            </div>

          </div>

          {/* ══════════════════════════════════════════════════════════════════
              🤖  ML INSIGHTS SECTION
          ══════════════════════════════════════════════════════════════════ */}
          {showML && (
            <div style={{ margin: '0 0 16px 0' }}>
              <div className="section-title" style={{ marginBottom: '12px' }}>
                🤖 ML Insights &amp; Recommendations
                <span style={{ fontSize: '12px', color: '#95a5a6', marginLeft: '12px', fontWeight: 'normal' }}>
                  Statistical anomaly detection · trend analysis · control suggestions
                </span>
              </div>

              {/* Row 1: Health Score | Radar | Maintenance */}
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 240px', gap: '12px', marginBottom: '12px' }}>

                {/* Health Score */}
                <div style={{ ...card(), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    System Health
                  </div>
                  {/* Circular-ish gauge via SVG */}
                  <svg width="120" height="120" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#2c3e50" strokeWidth="10" />
                    <circle cx="60" cy="60" r="50" fill="none"
                      stroke={healthColor(healthScore)} strokeWidth="10"
                      strokeDasharray={`${(healthScore / 100) * 314} 314`}
                      strokeLinecap="round"
                      transform="rotate(-90 60 60)" />
                    <text x="60" y="55" textAnchor="middle" fill="white" fontSize="22" fontWeight="bold">{healthScore}</text>
                    <text x="60" y="72" textAnchor="middle" fill={healthColor(healthScore)} fontSize="11">{healthLabel(healthScore)}</text>
                  </svg>
                  <div style={{ fontSize: '11px', color: '#95a5a6', marginTop: '6px', textAlign: 'center' }}>
                    Based on z-score anomalies<br />and trend analysis
                  </div>
                </div>

                {/* Sensor Radar */}
                <div style={card()}>
                  <div style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Sensor Normalcy Radar (100 = no anomaly)
                  </div>
                  <ResponsiveContainer width="100%" height={190}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#2c3e50" />
                      <PolarAngleAxis dataKey="sensor" tick={{ fill: '#95a5a6', fontSize: 11 }} />
                      <Radar name="Score" dataKey="score" stroke="#8e44ad" fill="#8e44ad" fillOpacity={0.35} />
                      <Tooltip contentStyle={{ backgroundColor: '#1a2332', border: '1px solid #2c3e50', color: '#fff', fontSize: '12px' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Maintenance Forecast */}
                <div style={card()}>
                  <div style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Predictive Maintenance
                  </div>
                  <div style={{ textAlign: 'center', marginBottom: '14px' }}>
                    <div style={{ fontSize: '28px', fontWeight: 'bold', color: healthColor(
                      maintenance.urgency === 'critical' ? 40 : maintenance.urgency === 'warning' ? 70 : 90
                    ) }}>
                      {maintenance.hours !== null ? `${maintenance.hours}h` : '∞'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#95a5a6', marginTop: '4px' }}>
                      {maintenance.label}
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: '#bdc3c7', marginTop: '8px' }}>
                    <strong style={{ color: '#ecf0f1' }}>Trend Summary</strong>
                    {ML_COLS.map(col => (
                      <div key={col} style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                        <span style={{ color: '#95a5a6' }}>{col}</span>
                        <span style={{ color: trendColor(trends[col]?.direction) }}>
                          {trendArrow(trends[col]?.direction ?? 'stable')} {trends[col]?.changePct ?? 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Row 2: Anomaly Table | Recommendations */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

                {/* Anomaly Detection */}
                <div style={card()}>
                  <div style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Anomaly Detection (Z-Score Analysis)
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2c3e50' }}>
                        {['Sensor', 'Latest', 'Mean', 'Std Dev', 'Z-Score', 'Status'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', color: '#95a5a6', textAlign: 'left', fontWeight: 'normal' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ML_COLS.map(col => {
                        const a = anomalies[col];
                        const latest = latestEntry?.[col];
                        return (
                          <tr key={col} style={{ borderBottom: '1px solid #1e2a38' }}>
                            <td style={{ padding: '7px 8px', color: SENSOR_COLORS[col] ?? '#fff', fontWeight: 'bold' }}>{col}</td>
                            <td style={{ padding: '7px 8px', color: '#ecf0f1' }}>
                              {typeof latest === 'number' ? latest.toFixed(3) : '—'}
                            </td>
                            <td style={{ padding: '7px 8px', color: '#bdc3c7' }}>{a.mean}</td>
                            <td style={{ padding: '7px 8px', color: '#bdc3c7' }}>±{a.std}</td>
                            <td style={{ padding: '7px 8px', color: a.isAnomaly ? '#e74c3c' : '#ecf0f1', fontWeight: a.isAnomaly ? 'bold' : 'normal' }}>
                              {a.zscore}
                            </td>
                            <td style={{ padding: '7px 8px' }}>
                              <span style={pill(severityColor(a.severity))}>
                                {a.severity.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div style={{ fontSize: '10px', color: '#636e72', marginTop: '8px' }}>
                    Threshold: Z &gt; 2.0 = anomaly | Z &gt; 1.5 = watch | Z &gt; 2.5 = warning | Z &gt; 3.5 = critical
                  </div>
                </div>

                {/* Recommendations */}
                <div style={card()}>
                  <div style={{ fontSize: '12px', color: '#95a5a6', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
                    Control &amp; Maintenance Recommendations
                  </div>
                  {recommendations.length === 0 ? (
                    <div style={{ color: '#27ae60', fontSize: '13px' }}>✅ No issues detected.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '260px', overflowY: 'auto' }}>
                      {recommendations.map((r, i) => (
                        <div key={i} style={{
                          backgroundColor: typeColor(r.type) + '12',
                          border: `1px solid ${typeColor(r.type)}33`,
                          borderLeft: `3px solid ${typeColor(r.type)}`,
                          borderRadius: '6px', padding: '10px 12px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '16px' }}>{r.icon}</span>
                            <span style={{ color: typeColor(r.type), fontSize: '13px', fontWeight: 'bold' }}>{r.title}</span>
                            <span style={{ ...pill(typeColor(r.type)), marginLeft: 'auto' }}>{r.type.toUpperCase()}</span>
                          </div>
                          <div style={{ color: '#bdc3c7', fontSize: '11px', lineHeight: '1.5' }}>{r.desc}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          )}

          {/* ── Status Footer ── */}
          <div className="status-footer">
            <div className="recording-status">
              <div className="rec-indicator">REC</div>
              <span>Recording Active — Last Update: {lastUpdated.toLocaleTimeString()}</span>
            </div>
            <div className="data-info">
              <span>Samples: {data.length}</span>
              <span>Health: {healthScore}/100</span>
              <span>Vib RMS: {vibrationRMS.toFixed(3)}</span>
              <span>Temp: {latestTemp.toFixed(2)} °C</span>
              <span>RPM: {latestRPM}</span>
              <span>Current: {latestCurrent.toFixed(3)} A</span>
              <span>RMS Mode: {rmsMode.toUpperCase()}</span>
              <span>Rate: 1 Hz</span>
            </div>
          </div>

        </div>
      </div>
    );
  };

  export default Dashboard;
