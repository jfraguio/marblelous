import './style.css';
import { AudioEngine } from './audio';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './renderer';
import { UI } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const audio = new AudioEngine();

if (new URLSearchParams(location.search).has('reset')) {
  try {
    localStorage.removeItem('marblelous.save.v1');
    localStorage.removeItem('marblelous.backup.v1');
    localStorage.removeItem('marblelous.snapshots.v1');
    localStorage.removeItem('marblelous.lastgame.v1');
  } catch {
    /* noop */
  }
  history.replaceState(null, '', location.pathname + location.hash);
}

const game = new Game(canvas, audio);
const renderer = new Renderer(canvas, game);
const ui = new UI(game);
const input = new Input(canvas, game, ui);

game.renderer = renderer;
game.ui = ui;
if (game.fresh) game.recenter();
game.start();

// Transición de entrada: el lienzo se revela cuando el nombre termina de asentarse.
const intro = document.getElementById('intro');
if (intro) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    intro.classList.add('is-out');
    document.body.classList.remove('intro-open');
    window.setTimeout(() => intro.remove(), reduced ? 40 : 480);
  };
  const timer = window.setTimeout(finish, reduced ? 160 : 1110);
  intro.addEventListener(
    'pointerdown',
    () => {
      window.clearTimeout(timer);
      finish();
    },
    { once: true }
  );
  intro.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
      window.clearTimeout(timer);
      finish();
    }
  });
}

// útil para soporte y pruebas; no expone datos personales
(window as unknown as { marblelous: unknown }).marblelous = { game, renderer, ui, input, audio };

// desbloqueo de audio en el primer gesto (iOS)
document.addEventListener(
  'pointerdown',
  () => {
    void audio.unlock();
  },
  { capture: true, passive: true }
);
document.addEventListener('keydown', () => void audio.unlock(), { once: true, capture: true });

// iOS Safari: evitar el zoom de página con el gesto de pellizco del sistema.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => {
  if ((e.target as HTMLElement).id === 'game') e.preventDefault();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* offline no disponible; el juego sigue */
    });
  });
}

// El canvas debe existir y tener foco de teclado en escritorio.
canvas.tabIndex = 0;
