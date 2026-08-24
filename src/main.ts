import Phaser from 'phaser';
import './style.css';
import { OverviewScene } from './scenes/OverviewScene';
import { RollScene } from './scenes/RollScene';
import { initUI } from './ui';
import { startSnow } from './snow';
import { initAudio } from './core/audio';

startSnow();
initUI();
initAudio();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-host',
  width: 1280,
  height: 640,
  transparent: true, // CSS sky/mountains/snow show through
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [OverviewScene, RollScene],
});

// debug hook for headless testing
(window as any).__game = game;
