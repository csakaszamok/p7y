// Ember drift: small warm particles rise, sway and fade behind the page. Draws on
// <canvas data-embers>, or creates one behind everything. Still (one frame) with
// prefers-reduced-motion; pauses while the tab is hidden.
;(() => {
  let canvas = document.querySelector('canvas[data-embers]')
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.setAttribute('data-embers', '')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none'
    document.body.prepend(canvas)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const colors = ['255,158,94', '255,196,107', '255,120,71']
  let w = 0, h = 0, embers = [], last = performance.now(), gust = 0, nextGust = 8 + Math.random() * 6, running = false

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w = canvas.clientWidth; h = canvas.clientHeight
    canvas.width = w * dpr; canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function spawn(anywhere) {
    const hero = Math.random() < 0.08, depth = 0.4 + Math.random() * 0.6
    return {
      x: Math.random() * w, y: anywhere ? Math.random() * h : h + 10,
      r: hero ? 2.2 : (0.75 + Math.random() * 0.75) * depth * 1.6,
      speed: (20 + Math.random() * 30) * depth, sway: 6 + Math.random() * 10,
      phase: Math.random() * Math.PI * 2, life: anywhere ? Math.random() * 6 : 0, ttl: 6 + Math.random() * 6,
      alpha: (0.25 + Math.random() * 0.55) * depth, hero, c: colors[(Math.random() * colors.length) | 0],
    }
  }

  function draw(dt) {
    nextGust -= dt
    if (nextGust <= 0) { gust = 2; nextGust = 8 + Math.random() * 6 }
    const gustDx = gust > 0 ? 15 * dt : 0
    gust = Math.max(0, gust - dt)
    ctx.clearRect(0, 0, w, h)
    for (let i = 0; i < embers.length; i++) {
      const e = embers[i]
      e.life += dt; e.y -= e.speed * dt; e.x += gustDx
      const t = e.life / e.ttl
      if (t >= 1 || e.y < -10) { embers[i] = spawn(false); continue }
      const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1
      ctx.globalAlpha = e.alpha * fade
      ctx.shadowBlur = e.hero ? 10 : 0
      ctx.shadowColor = `rgba(${e.c},0.9)`
      ctx.fillStyle = `rgb(${e.c})`
      ctx.beginPath()
      ctx.arc(e.x + Math.sin(e.phase + e.life * 1.3) * e.sway, e.y, e.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0
  }

  function frame(now) {
    if (document.hidden) { running = false; return }
    draw(Math.min((now - last) / 1000, 0.05)); last = now
    requestAnimationFrame(frame)
  }

  function start() {
    if (still || running) return
    running = true; last = performance.now(); requestAnimationFrame(frame)
  }

  resize()
  embers = Array.from({ length: Math.round(Math.min(90, (w * h) / 16000)) }, () => spawn(true))
  addEventListener('resize', resize)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start() })
  if (still) draw(0)
  else start()
})()
