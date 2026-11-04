import { Game } from './game.js';
import { UI } from './ui.js';

const game = new Game(document.getElementById('game'));
game.ui = new UI(game);
game.ui.showMain();
document.getElementById('loading').remove();

// Exposed for debugging from the devtools console.
window.velocity = game;
