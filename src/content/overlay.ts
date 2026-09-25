import { sendToBackground } from '@/lib/messaging'

/**
 * A small status panel pinned to the page during a run.
 *
 * Deliberately plain DOM inside a closed shadow root rather than React: this
 * gets injected into every LinkedIn page, so it should weigh almost nothing,
 * and the shadow boundary means LinkedIn's stylesheet can't reach in (nor ours
 * out). Without something like this, an automated run is invisible and the only
 * way to stop it is to close the tab.
 */

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null

const STYLE = `
  :host { all: initial; }
  .panel {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    width: 280px;
    padding: 14px 16px;
    border-radius: 12px;
    background: #12121a;
    color: #f4f4f5;
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    box-shadow: 0 10px 40px rgba(0,0,0,.45);
    border: 1px solid rgba(255,255,255,.1);
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #4ade80; flex: none;
    animation: pulse 1.6s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
  @media (prefers-reduced-motion: reduce) { .dot { animation: none } }
  .title { font-weight: 600; letter-spacing: .01em; }
  .status { margin-top: 8px; font-weight: 500; }
  .detail {
    margin-top: 4px;
    color: #a1a1aa;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .actions { margin-top: 12px; display: flex; gap: 8px; }
  button {
    flex: 1;
    padding: 6px 10px;
    border-radius: 7px;
    border: 1px solid rgba(255,255,255,.14);
    background: rgba(255,255,255,.06);
    color: #f4f4f5;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  button:hover { background: rgba(255,255,255,.12); }
  button.stop { border-color: rgba(248,113,113,.4); color: #fca5a5; }
`

function ensureMounted(): ShadowRoot {
  if (shadow && host?.isConnected) return shadow

  host = document.createElement('div')
  host.id = 'losjobios-overlay-host'
  // Closed so page scripts can't reach in and rewrite what the user is reading.
  shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = STYLE

  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.innerHTML = `
    <div class="row"><span class="dot"></span><span class="title">LosJobios</span></div>
    <div class="status" data-status></div>
    <div class="detail" data-detail></div>
    <div class="actions">
      <button data-pause>Pause</button>
      <button class="stop" data-stop>Stop</button>
    </div>
  `

  panel.querySelector('[data-pause]')?.addEventListener('click', () => {
    void sendToBackground('run/pause').catch(() => {})
  })
  panel.querySelector('[data-stop]')?.addEventListener('click', () => {
    void sendToBackground('run/stop').catch(() => {})
    hideOverlay()
  })

  shadow.append(style, panel)
  document.documentElement.append(host)

  return shadow
}

export function showOverlay(status: string, detail = ''): void {
  const root = ensureMounted()
  const statusEl = root.querySelector('[data-status]')
  const detailEl = root.querySelector('[data-detail]')
  if (statusEl) statusEl.textContent = status
  if (detailEl) detailEl.textContent = detail
  if (host) host.style.display = ''
}

export function hideOverlay(): void {
  if (host) host.style.display = 'none'
}

export function destroyOverlay(): void {
  host?.remove()
  host = null
  shadow = null
}
