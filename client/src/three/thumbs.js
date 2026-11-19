import * as THREE from 'three';
import { Character } from './character.js';
import { HAIR_COUNT } from '../../../shared/look.js';

// Saç stillerinin küçük önizleme görselleri (saç rengine göre önbelleklenir).
let rig;
const cache = new Map();

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 2.5, 3);
  scene.add(key);
  const ch = new Character();
  ch.root.rotation.y = 0.5;
  scene.add(ch.root);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  camera.position.set(0, 1.74, 1.02);
  camera.lookAt(0, 1.7, 0);
  return { canvas, renderer, scene, ch, camera };
}

export function hairThumbs(look) {
  const key = look.hairColor;
  if (cache.has(key)) return cache.get(key);
  rig ||= setup();
  const out = [];
  for (let i = 0; i < HAIR_COUNT; i++) {
    rig.ch.setLook({ ...look, hair: i }, 'player', '');
    rig.renderer.render(rig.scene, rig.camera);
    out.push(rig.canvas.toDataURL('image/png'));
  }
  cache.set(key, out);
  return out;
}
