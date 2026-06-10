'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { ScanLine, LayoutDashboard, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type ScanResult = 'admitted' | 'duplicate' | 'not_found' | 'invalid';

interface ScanResponse {
  result: ScanResult;
  order_id?: string;
  customer_name?: string;
  ticket_type?: string;
  quantity?: number;
  first_scan_at?: string;
  message: string;
  message_ar?: string;
}

interface GateStats {
  total_scanned: number;
  admitted: number;
  duplicates: number;
  not_found: number;
  scans_last_5_min: number;
  recent_scans: Array<{
    result: string;
    customer_name: string | null;
    ticket_type: string | null;
    order_id: string | null;
    created_at: string;
    message: string | null;
  }>;
}

const GATE_OPTIONS = ['Gate 1', 'Gate 2', 'Gate 3', 'Main Entrance', 'VIP Entrance'];

const RESULT_COLORS: Record<ScanResult, string> = {
  admitted: 'bg-emerald-500',
  duplicate: 'bg-red-500',
  not_found: 'bg-amber-500',
  invalid: 'bg-zinc-500',
};

// ─── Audio helpers ────────────────────────────────────────────────────────────

function beepSuccess(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.2);
}

function beepError(ctx: AudioContext) {
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 320;
    const start = ctx.currentTime + i * 0.25;
    gain.gain.setValueAtTime(0.3, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);
    osc.start(start);
    osc.stop(start + 0.15);
  }
}

// ─── Dashboard tab ────────────────────────────────────────────────────────────

function DashboardTab({ eventId }: { eventId: string }) {
  const [stats, setStats] = useState<GateStats | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [manualResult, setManualResult] = useState<ScanResponse | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/gate/scan?event_id=${eventId}`);
      if (res.ok) setStats(await res.json() as GateStats);
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    fetchStats();
    const id = setInterval(fetchStats, 10_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  async function handleManualLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!manualCode.trim()) return;
    setManualLoading(true);
    setManualResult(null);
    try {
      const res = await fetch('/api/gate/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: eventId, scanned_code: manualCode.trim() }),
      });
      setManualResult(await res.json() as ScanResponse);
      setManualCode('');
    } catch { /* ignore */ }
    finally { setManualLoading(false); }
  }

  return (
    <div className="space-y-6 p-4">
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Admitted', value: stats.admitted, color: 'text-emerald-400' },
            { label: 'Duplicates', value: stats.duplicates, color: 'text-red-400' },
            { label: 'Not found', value: stats.not_found, color: 'text-amber-400' },
            { label: 'Last 5 min', value: stats.scans_last_5_min, color: 'text-sky-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg bg-zinc-800 p-3 text-center">
              <div className={cn('text-2xl font-bold tabular-nums', color)}>{value}</div>
              <div className="mt-0.5 text-xs text-zinc-400">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Manual lookup */}
      <form onSubmit={handleManualLookup} className="flex gap-2">
        <input
          type="text"
          className="flex-1 rounded-md bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          placeholder="Enter order ID manually…"
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
        />
        <button
          type="submit"
          disabled={manualLoading || !manualCode.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {manualLoading ? '…' : 'Admit'}
        </button>
      </form>

      {manualResult && (
        <div
          className={cn(
            'rounded-md px-4 py-3 text-sm font-medium',
            manualResult.result === 'admitted' ? 'bg-emerald-900 text-emerald-300' :
            manualResult.result === 'duplicate' ? 'bg-red-900 text-red-300' :
            'bg-amber-900 text-amber-300',
          )}
        >
          {manualResult.message}
          {manualResult.customer_name && (
            <div className="mt-0.5 text-xs opacity-70">{manualResult.customer_name}</div>
          )}
        </div>
      )}

      {/* Recent scans feed */}
      {stats && stats.recent_scans.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Recent scans</p>
            <button onClick={fetchStats} className="text-zinc-500 hover:text-white">
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-1 overflow-y-auto" style={{ maxHeight: '40vh' }}>
            {stats.recent_scans.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-xs">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    s.result === 'admitted' ? 'bg-emerald-500' :
                    s.result === 'duplicate' ? 'bg-red-500' :
                    'bg-amber-500',
                  )}
                />
                <span className="flex-1 truncate text-zinc-300">
                  {s.customer_name ?? s.order_id ?? '—'}
                </span>
                {s.ticket_type && (
                  <span className="shrink-0 text-zinc-500">{s.ticket_type}</span>
                )}
                <span className="shrink-0 text-zinc-600">
                  {new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface GateScannerProps {
  eventId: string;
  eventName: string;
}

export function GateScanner({ eventId, eventName }: GateScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastScannedRef = useRef<{ code: string; ts: number } | null>(null);

  const [tab, setTab] = useState<'scan' | 'dashboard'>('scan');
  const [gateName, setGateName] = useState(GATE_OPTIONS[0]);
  const [customGate, setCustomGate] = useState('');
  const [admitCount, setAdmitCount] = useState(0);
  const [flash, setFlash] = useState<ScanResult | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const effectiveGate = gateName === 'custom' ? customGate : gateName;

  // ── Camera init ──
  useEffect(() => {
    if (tab !== 'scan') return;

    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setScanning(true);
          setCameraError(null);
        }
      } catch {
        setCameraError('Camera access denied. Enable camera permissions and reload.');
      }
    }

    startCamera();

    return () => {
      cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      setScanning(false);
    };
  }, [tab]);

  // ── Scan loop ──
  useEffect(() => {
    if (!scanning) return;

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }

      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = jsQR(imageData.data, imageData.width, imageData.height);

      if (qr) {
        const now = Date.now();
        const last = lastScannedRef.current;
        // 3-second debounce per unique code
        if (!last || last.code !== qr.data || now - last.ts > 3000) {
          lastScannedRef.current = { code: qr.data, ts: now };
          handleScan(qr.data);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning, eventId, effectiveGate]);

  async function handleScan(code: string) {
    try {
      const res = await fetch('/api/gate/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          scanned_code: code,
          gate_name: effectiveGate || undefined,
          scanner_device: navigator.userAgent.slice(0, 100),
        }),
      });

      const data = (await res.json()) as ScanResponse;
      setLastResult(data);
      setFlash(data.result);
      setTimeout(() => setFlash(null), 800);

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (data.result === 'admitted') {
        setAdmitCount((c) => c + 1);
        beepSuccess(ctx);
      } else {
        beepError(ctx);
      }
    } catch { /* ignore network errors */ }
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-900 text-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-zinc-400">{eventName}</p>
          <select
            className="mt-0.5 bg-transparent text-sm font-semibold text-white focus:outline-none"
            value={gateName}
            onChange={(e) => setGateName(e.target.value)}
          >
            {GATE_OPTIONS.map((g) => (
              <option key={g} value={g} className="bg-zinc-900">
                {g}
              </option>
            ))}
            <option value="custom" className="bg-zinc-900">
              Custom…
            </option>
          </select>
          {gateName === 'custom' && (
            <input
              type="text"
              className="mt-1 w-full rounded bg-zinc-800 px-2 py-1 text-xs text-white focus:outline-none"
              placeholder="Gate name…"
              value={customGate}
              onChange={(e) => setCustomGate(e.target.value)}
            />
          )}
        </div>
        {/* Admit counter */}
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold tabular-nums text-emerald-400">{admitCount}</div>
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">admitted</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-zinc-800">
        {(['scan', 'dashboard'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors',
              tab === t ? 'border-b-2 border-emerald-500 text-white' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t === 'scan' ? <ScanLine className="h-3.5 w-3.5" /> : <LayoutDashboard className="h-3.5 w-3.5" />}
            {t === 'scan' ? 'Scan' : 'Dashboard'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden">
        {/* ── Scan tab ── */}
        {tab === 'scan' && (
          <div className="relative h-full w-full bg-black">
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />
            {/* Hidden canvas for QR decoding */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Viewfinder overlay */}
            {!cameraError && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-56 w-56">
                  {/* Corner guides */}
                  {['top-0 left-0', 'top-0 right-0 rotate-90', 'bottom-0 right-0 rotate-180', 'bottom-0 left-0 -rotate-90'].map((pos, i) => (
                    <div
                      key={i}
                      className={cn('absolute h-8 w-8 border-white', pos)}
                      style={{ borderTopWidth: 3, borderLeftWidth: 3 }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Flash overlay */}
            {flash && (
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 opacity-40',
                  RESULT_COLORS[flash],
                )}
              />
            )}

            {/* Camera error */}
            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-zinc-900 p-6 text-center text-sm text-zinc-400">
                {cameraError}
              </div>
            )}

            {/* Last result pill */}
            {lastResult && (
              <div className="absolute bottom-6 left-1/2 w-72 max-w-[90vw] -translate-x-1/2">
                <div
                  className={cn(
                    'rounded-xl px-4 py-3 text-center shadow-lg',
                    lastResult.result === 'admitted' ? 'bg-emerald-900/90 text-emerald-300' :
                    lastResult.result === 'duplicate' ? 'bg-red-900/90 text-red-300' :
                    'bg-amber-900/90 text-amber-300',
                  )}
                >
                  <p className="text-base font-semibold">{lastResult.message}</p>
                  {lastResult.message_ar && (
                    <p className="mt-0.5 text-sm opacity-80" dir="rtl">{lastResult.message_ar}</p>
                  )}
                  {lastResult.customer_name && (
                    <p className="mt-1 text-xs opacity-70">{lastResult.customer_name}</p>
                  )}
                  {lastResult.ticket_type && (
                    <p className="text-xs opacity-60">{lastResult.ticket_type}{lastResult.quantity && lastResult.quantity > 1 ? ` ×${lastResult.quantity}` : ''}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Dashboard tab ── */}
        {tab === 'dashboard' && (
          <div className="h-full overflow-y-auto">
            <DashboardTab eventId={eventId} />
          </div>
        )}
      </div>
    </div>
  );
}
