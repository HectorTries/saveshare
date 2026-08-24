/* ---------- tiny global event bus (scenes <-> DOM UI) ---------- */
import Phaser from 'phaser';

export const bus = new Phaser.Events.EventEmitter();
