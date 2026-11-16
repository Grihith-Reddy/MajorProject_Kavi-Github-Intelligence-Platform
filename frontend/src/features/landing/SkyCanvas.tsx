import { useEffect, useRef } from 'react'

/**
 * Animated cloud sky for the landing hero (in the spirit of 21st.dev "Cloudscape"):
 * layered fractal noise drifting slowly, a sun glow by day, a moon and faint stars by night.
 * Follows the app theme and cross-fades when it changes. Renders at a fraction of the
 * screen resolution (clouds are soft), pauses when off screen, and draws one still frame
 * under reduced motion. Falls back to the CSS gradient behind it if WebGL is unavailable.
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uNight;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  // Sky gradient: horizon (bottom) to zenith (top)
  // Day colours are the app's sky tokens (#15aeea at the zenith, #73cef2 at the horizon), so the
  // hero sky matches the sky sections further down the page.
  vec3 dayTop = vec3(0.082, 0.682, 0.918), dayHor = vec3(0.451, 0.808, 0.949);
  vec3 nightTop = vec3(0.035, 0.07, 0.13), nightHor = vec3(0.15, 0.23, 0.32);
  vec3 col = mix(mix(dayHor, nightHor, uNight), mix(dayTop, nightTop, uNight), smoothstep(0.0, 1.0, uv.y));

  // Sun / moon in the upper right, clear of the headline. Measured in units of the shorter side
  // so it stays the same size on a tall phone as on a wide desktop.
  float unit = min(uRes.x, uRes.y);
  // On tall phones the top is taken by the headline, so the orb sits lower, above the mountain.
  float orbY = mix(0.66, 0.88, smoothstep(0.6, 1.2, aspect));
  vec2 orbPx = vec2(uRes.x * 0.84, uRes.y * orbY);
  float d = length(gl_FragCoord.xy - orbPx) / unit;
  col += mix(vec3(1.0, 0.97, 0.86) * 0.22, vec3(0.72, 0.8, 0.95) * 0.28, uNight) * exp(-d * 3.6);

  // Stars (night only), hidden behind clouds below
  vec2 cell = p * vec2(90.0);
  vec2 id = floor(cell);
  vec2 f = fract(cell) - 0.5;
  float h = hash(id);
  vec2 offset = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.6;
  float twinkle = 0.55 + 0.45 * sin(uTime * 1.3 + h * 50.0);
  float star = step(0.986, h) * smoothstep(0.07, 0.0, length(f - offset)) * twinkle * smoothstep(0.3, 0.85, uv.y);

  // Clouds: domain-warped noise drifting sideways. Scroll motion comes from the parallax layer that
  // holds this canvas (moved by the GPU), so the picture itself never has to redraw for scrolling.
  float t = uTime * 0.011;
  vec2 q = p * vec2(1.05, 1.9) + vec2(t, 0.0);
  float warp = fbm(q * 0.7 + vec2(t * 0.6, -t * 0.3)) * 0.9;
  float c = fbm(q + warp);
  // fbm here spans roughly 0.18-0.68, so the cloud thresholds sit inside that range
  float cover = smoothstep(0.33, 0.56, c) * smoothstep(0.02, 0.38, uv.y);
  vec3 shade = mix(vec3(0.74, 0.8, 0.88), vec3(0.15, 0.19, 0.27), uNight);
  vec3 bright = mix(vec3(1.0, 1.0, 1.0), vec3(0.36, 0.42, 0.53), uNight);
  // bright tops, soft grey undersides: compare with the noise a little lower down
  float under = fbm(q + vec2(0.0, -0.18) + warp); // reuses the warp: three noise stacks per pixel, not four
  vec3 cloud = mix(shade, bright, smoothstep(0.36, 0.62, c) * (0.65 + 0.35 * smoothstep(0.0, 0.12, c - under)));
  col += vec3(star) * 0.85 * uNight * (1.0 - cover);
  col = mix(col, cloud, cover * mix(0.94, 0.78, uNight));

  // Moon disc with a soft edge, drawn over thin clouds
  col = mix(col, vec3(0.93, 0.95, 1.0), uNight * smoothstep(0.034, 0.028, d) * (1.0 - cover * 0.6));

  gl_FragColor = vec4(col, 1.0);
}
`

const RENDER_SCALE = 0.55 // soft clouds look the same at half resolution and cost a quarter
const MAX_WIDTH = 900 // pixel budget for very wide or high-density screens
const FRAME_MS = 1000 / 30 - 2 // the clouds drift slowly; 30 fps looks the same and halves GPU time

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
}

export function SkyCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' })
    if (!gl) return // CSS gradient behind the canvas stays visible
    const vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'aPos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    const uRes = gl.getUniformLocation(program, 'uRes')
    const uTime = gl.getUniformLocation(program, 'uTime')
    const uNight = gl.getUniformLocation(program, 'uNight')

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let night = isDark() ? 1 : 0
    let nightTarget = night
    let visible = true
    let raf = 0
    let lastDraw = 0
    const start = performance.now() - 40_000 // start mid-drift so the first frame already has clouds

    const resize = () => {
      // Layout size, not getBoundingClientRect: the hero card opens with a scale transform.
      const scale = Math.min(Math.min(window.devicePixelRatio || 1, 1.5) * RENDER_SCALE, MAX_WIDTH / Math.max(canvas.clientWidth, 1))
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    const draw = (now: number) => {
      night += (nightTarget - night) * 0.06
      if (Math.abs(nightTarget - night) < 0.001) night = nightTarget
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uTime, reduceMotion.matches ? 40 : (now - start) / 1000)
      gl.uniform1f(uNight, night)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const loop = (now: number) => {
      const settling = night !== nightTarget
      if (settling || now - lastDraw >= FRAME_MS) { lastDraw = now; draw(now) }
      if (visible && (!reduceMotion.matches || settling)) raf = requestAnimationFrame(loop)
      else raf = 0
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(loop) }

    resize()
    draw(performance.now())
    kick()

    const resizeObserver = new ResizeObserver(() => { resize(); draw(performance.now()) })
    resizeObserver.observe(canvas)
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) kick() })
    visibility.observe(canvas)
    const themeObserver = new MutationObserver(() => { nightTarget = isDark() ? 1 : 0; kick() })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const onMotionChange = () => kick()
    reduceMotion.addEventListener('change', onMotionChange)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      visibility.disconnect()
      themeObserver.disconnect()
      reduceMotion.removeEventListener('change', onMotionChange)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
