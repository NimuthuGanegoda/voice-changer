import { useEffect, useRef } from "react";

type OscilloscopeProps = {
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
  running: boolean;
  bypass: boolean;
};

export function Oscilloscope({ inputAnalyser, outputAnalyser, running, bypass }: OscilloscopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let rafId = 0;
    let phase = 0;
    const waveBuf = new Float32Array(512);
    const inBuf = new Float32Array(512);
    const freqBuf = new Uint8Array(256);

    const drawFrame = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 160;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cs = getComputedStyle(document.documentElement);
      const trace = cs.getPropertyValue("--trace").trim() || "#ff8a3d";
      const dryColor = cs.getPropertyValue("--text-muted").trim() || "#8b93a1";
      const line = cs.getPropertyValue("--line").trim() || "#262b33";

      ctx.clearRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      for (let i = 1; i < 8; i++) {
        const x = (w / 8) * i;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      ctx.stroke();

      if (running && outputAnalyser) {
        // Spectrum bars subtly in background
        outputAnalyser.getByteFrequencyData(freqBuf);
        const barCount = 48;
        const barW = w / barCount;
        ctx.fillStyle = bypass ? "rgba(139, 147, 161, 0.16)" : "rgba(255, 138, 61, 0.16)";
        for (let b = 0; b < barCount; b++) {
          const val = (freqBuf[b * 2] ?? 0) / 255;
          const bh = val * (h * 0.72);
          ctx.fillRect(b * barW + 1, h - bh, Math.max(1, barW - 2), bh);
        }

        // Dry input trace
        if (inputAnalyser) {
          inputAnalyser.getFloatTimeDomainData(inBuf);
          ctx.beginPath();
          ctx.strokeStyle = dryColor;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.3;
          for (let i = 0; i < inBuf.length; i++) {
            const x = (i / (inBuf.length - 1)) * w;
            const y = h / 2 + (inBuf[i] ?? 0) * (h * 0.38);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // Converted wet output trace
        outputAnalyser.getFloatTimeDomainData(waveBuf);
        ctx.beginPath();
        ctx.strokeStyle = bypass ? dryColor : trace;
        ctx.lineWidth = 2.2;
        for (let i = 0; i < waveBuf.length; i++) {
          const x = (i / (waveBuf.length - 1)) * w;
          const y = h / 2 + (waveBuf[i] ?? 0) * (h * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // Calm idle carrier trace
        ctx.beginPath();
        ctx.strokeStyle = trace;
        ctx.globalAlpha = 0.65;
        ctx.lineWidth = 1.75;
        const steps = 180;
        for (let i = 0; i <= steps; i++) {
          const x = (i / steps) * w;
          const t = (i / steps) * Math.PI * 6 + phase;
          const env = 0.3 + 0.7 * Math.sin((i / steps) * Math.PI);
          const y = h / 2 + Math.sin(t) * 14 * env + Math.sin(t * 2.1 + 1.2) * 6 * env;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        phase += 0.03;
      }

      if (!reduceMotion) {
        rafId = requestAnimationFrame(drawFrame);
      }
    };

    drawFrame();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [inputAnalyser, outputAnalyser, running, bypass]);

  return <canvas ref={canvasRef} className="scope-canvas" aria-label="Realtime audio oscilloscope and frequency analyzer" />;
}
