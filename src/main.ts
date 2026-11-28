import './style.css';
import { clearWorkshopStorage } from './album';
import { AudioEngine } from './audio';
import { Game } from './game';
import { Input } from './input';
import { Renderer } from './renderer';
import { UI } from './ui';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const audio = new AudioEngine();

if (new URLSearchParams(location.search).has('reset')) {
  try {
    clearWorkshopStorage(localStorage);
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
