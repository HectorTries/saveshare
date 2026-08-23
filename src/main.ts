import Phaser from 'phaser';
import './style.css';
import { GameScene } from './scenes/GameScene';
import { initUI } from './ui';
import { startSnow } from './snow';

startSnow();
initUI();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-host',
  width: 1280,
  height: 640,
  backgroundColor: '#0F1A2E',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 1 },
      enableSleeping: true,
      debug: false,
    },
  },
  scene: [GameScene],
});

// debug hook for headless testing
(window as any).__game = game;
