'use client';

import { useEffect, useRef } from 'react';

/**
 * Cinematic WebGL atmosphere for the login page.
 *
 * A single full-screen fragment shader renders slow, flowing, domain-warped
 * fBm "clouds" in a dark warm-espresso palette with soft ember light blooms,
 * a mouse-reactive warm light, in-shader film grain and a vignette. It reads as
 * volumetric light moving through a dark room — alive but restrained.
 *
 * Performance / accessibility:
 *  - GPU only, no per-pixel JS; renders at reduced internal resolution (the
 *    field is soft, so this is invisible) and caps DPR.
 *  - Pauses when the tab is hidden.
 *  - prefers-reduced-motion → one static composed frame, no loop, no pointer.
 *  - If WebGL is unavailable, the CSS gradient fallback below simply shows.
 */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;

// --- value noise + fbm -----------------------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = uv;
  p.x *= aspect;

  float t = uTime * 0.025;

  // domain warping — layered flow, the "fluid" feel
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p + 1.6 * q + vec2(1.7, 9.2) + 0.15 * t),
    fbm(p + 1.6 * q + vec2(8.3, 2.8) - 0.12 * t)
  );
  float f = fbm(p + 2.0 * r);

  // warm dark palette: near-black espresso -> warm charcoal -> deep amber-brown.
  // Deeper base + tighter highlight ramp gives cinematic contrast (shadow
  // pockets + focused warm blooms) rather than a flat sepia wash.
  vec3 c1 = vec3(0.024, 0.019, 0.015);
  vec3 c2 = vec3(0.082, 0.063, 0.045);
  vec3 c3 = vec3(0.275, 0.178, 0.101);
  vec3 col = mix(c1, c2, clamp(f * 1.15, 0.0, 1.0));
  col = mix(col, c3, clamp(pow(f, 2.6) * 1.5, 0.0, 1.0));

  // faint upper light source (soft ivory diffusion, drifting)
  vec2 lc = vec2(0.5 * aspect + 0.18 * sin(t * 1.2), 0.28 + 0.05 * cos(t * 0.9));
  float dl = distance(p, lc);
  col += vec3(0.16, 0.13, 0.09) * exp(-dl * dl * 2.2) * (0.5 + 0.5 * r.x);

  // mouse-reactive warm ember bloom
  vec2 m = uMouse;
  m.x *= aspect;
  float dm = distance(p, m);
  col += vec3(0.28, 0.17, 0.08) * exp(-dm * dm * 3.0) * (0.45 + 0.4 * f);

  // ember specks riding the flow (very restrained)
  float ember = smoothstep(0.72, 0.98, f + 0.15 * r.y);
  col += vec3(0.32, 0.19, 0.09) * ember * 0.5;

  // film grain
  float g = hash(gl_FragCoord.xy + fract(uTime) * 43.1) - 0.5;
  col += g * 0.055;

  // cinematic vignette
  float vig = smoothstep(1.1, 0.3, distance(uv, vec2(0.5)));
  col *= mix(0.5, 1.0, vig);

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function CinematicBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    // Non-null declared type so the render closures keep it across scopes.
    const canvas: HTMLCanvasElement = el;

    const ctx = (canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'low-power',
    }) || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!ctx) return; // CSS fallback shows
    const gl: WebGLRenderingContext = ctx;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uMouse = gl.getUniformLocation(prog, 'uMouse');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scale = 0.7; // soft field → render below native res for cheap GPU cost

    function resize() {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      const pw = Math.max(2, Math.min(1800, Math.floor(w * dpr * scale)));
      const ph = Math.max(2, Math.min(1800, Math.floor(h * dpr * scale)));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
        gl.viewport(0, 0, pw, ph);
      }
    }

    const mouse = { x: 0.5, y: 0.62, tx: 0.5, ty: 0.62 };
    const onMove = (e: PointerEvent) => {
      mouse.tx = e.clientX / window.innerWidth;
      mouse.ty = 1 - e.clientY / window.innerHeight;
    };

    let raf = 0;
    const start = performance.now();
    const draw = (tSec: number) => {
      resize();
      gl.uniform1f(uTime, tSec);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      mouse.x += (mouse.tx - mouse.x) * 0.045;
      mouse.y += (mouse.ty - mouse.y) * 0.045;
      draw((now - start) / 1000);
    };

    const onVis = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else if (!reduce && !raf) {
        raf = requestAnimationFrame(frame);
      }
    };

    resize();
    if (reduce) {
      draw(14.0); // one composed static frame
    } else {
      window.addEventListener('pointermove', onMove, { passive: true });
      document.addEventListener('visibilitychange', onVis);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, []);

  return (
    <div className={className} aria-hidden>
      {/* CSS fallback / pre-paint base — warm dark radial. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 26%, #211a13 0%, #14100c 52%, #0a0806 100%)',
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
