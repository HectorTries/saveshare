import Phaser from 'phaser';
import './style.css';
import { OverviewScene } from './scenes/OverviewScene';
import { HillScene } from './scenes/HillScene';
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
  input: {
    // don't let clicks on DOM overlays/buttons leak into game hit-testing
    windowEvents: false,
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [OverviewScene, HillScene],
});

// debug hook for headless testing
(window as any).__game = game;
