import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ---------- State ----------
const state = {
  whistleDetected: false,
  magicRevealed: false,
  walkSpeed: 5,
  inBoat: false,
  treasureChestPickedUp: false,
  treasureChestOpened: false,
  hasSilverWhistle: false,
  boatLanternHeld: false,
  boatLanternFlying: false,
  sweetMessageShown: false,
};

// Boat house and dock in the south (positive Z)
const SOUTH_Z = 70;
// Treasure: center along the moon (x=0) so boat lines up with moon + message
const DOCK_Z = 1 + SOUTH_Z;
const BOAT_START_Z = SOUTH_Z -1;
const TREASURE_X = 0;
const TREASURE_Z = -55;
const TREASURE_PICKUP_RANGE = 5;
const TREASURE_BEAM_HEIGHT = 32;  // sky height for light stream

// ---------- DOM ----------
const canvas = document.getElementById('canvas');
const hint = document.getElementById('hint');
const prompt = document.getElementById('prompt');
const startOverlay = document.getElementById('start-overlay');
const btnStart = document.getElementById('btn-start');
const flowerTag = document.getElementById('flower-tag');

// ---------- Three.js core ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020104); // Darker night
scene.fog = new THREE.FogExp2(0x050810, 0.012);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 500);
// Start at boat house (south); walk to dock, press G to enter boat
camera.position.set(0, 3.5, 25 + SOUTH_Z);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.1;
controls.maxDistance = 0.1;
controls.target.set(0, 3.5, 20 + SOUTH_Z);

// Bloom
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.15, 0.8, 0.9);
composer.addPass(bloomPass);

// ---------- Shared objects (boat scene only) ----------
let boatSceneGroup, boatMovingGroup, seaMesh, seaGlowMesh, seaGlowGroup, starsGroup, balloonsGroup, lanternsGroup, decorationsGroup, candlesGroup, firefliesGroup;
let fireworksGroup, sparklesGroup;
let seaFoamPoints, seaSplashes;
let magicFlower, starMessageGroup, starMessageText;
let boatFlyableLantern, sweetMessageGroup, sweetMessageText;
let treasureChestGroup, treasureSpotLight, treasureLightStreamMesh, boatChestGroup;
let boatChestLid, boatChestWhistle;  // refs for open animation and whistle inside
let whistleInHand;       // whistle in front of camera when taken
let goldDustPoints;      // particle system when chest disappears
let chestLidOpenT = 0;   // 0..1 for lid open animation
const _chestWorldPos = new THREE.Vector3();
let ambientLight, hemisphereLight, moonLight, moonMesh;
const boatVelocity = new THREE.Vector3();
let boatSpeed = 0;
let boatYawVelocity = 0;
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _forwardNow = new THREE.Vector3();
const _seatOffset = new THREE.Vector3(0, 0.7, 0.8);
const _seatWorld = new THREE.Vector3();
const _lookDir = new THREE.Vector3();
const _distToBoat = new THREE.Vector3(0, 0.5, BOAT_START_Z);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
let _animateFrame = 0;

// ---------- Sea with wave animation, vertex-colored foam, and glow ----------
function createSea() {
  const w = 400;
  const h = 400;
  const segW = 48;
  const segH = 48;
  const oceanGeo = new THREE.PlaneGeometry(w, h, segW, segH);
  oceanGeo.rotateX(-Math.PI / 2);
  
  const pos = oceanGeo.attributes.position;
  const baseY = new Float32Array(pos.count);
  // Add color attribute for vertex coloring
  const colors = new Float32Array(pos.count * 3);
  
  for (let i = 0; i < pos.count; i++) {
    baseY[i] = pos.getY(i);
    // Init colors (will be updated in animation)
    colors[i*3] = 0;
    colors[i*3+1] = 0.05;
    colors[i*3+2] = 0.15;
  }
  oceanGeo.userData.baseY = baseY;
  oceanGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const oceanMat = new THREE.MeshStandardMaterial({
    vertexColors: true,     // Use our calculated colors
    roughness: 0.04,        // Wet look
    metalness: 0.8,         // Reflective
    emissive: 0x000510,     // Very dark base glow
    emissiveIntensity: 0.2,
    flatShading: false,
  });
  
  seaMesh = new THREE.Mesh(oceanGeo, oceanMat);
  seaMesh.position.y = -0.15;
  seaMesh.receiveShadow = true;
  boatSceneGroup.add(seaMesh);

  // Soft magical glow layer (underwater volumetric feel)
  const glowGeo = new THREE.PlaneGeometry(w * 1.02, h * 1.02, 1, 1);
  glowGeo.rotateX(-Math.PI / 2);
  seaGlowMesh = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
    color: 0x0044aa,        // Darker blue glow
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  seaGlowMesh.position.y = -0.06;
  boatSceneGroup.add(seaGlowMesh);
}

// ---------- Wave animation + dynamic colors (magical, lively) ----------
function updateSeaWaves(t) {
  if (!seaMesh || !seaMesh.geometry?.userData?.baseY) return;
  
  const geo = seaMesh.geometry;
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const baseY = geo.userData.baseY;
  
  // Get boat position to create a "dry zone" under it
  const boatX = boatMovingGroup ? boatMovingGroup.position.x : 0;
  const boatZ = boatMovingGroup ? boatMovingGroup.position.z : 0;
  
  const speed = 0.8;
  const k1 = 0.15, A1 = 0.3;
  const k2 = 0.35, A2 = 0.15;
  const k3 = 0.6,  A3 = 0.08;
  const k4 = 1.2,  A4 = 0.04;

  // Colors - DARKER
  const cDeep = { r: 0.0, g: 0.02, b: 0.08 };   // Pitch dark blue
  const cMid  = { r: 0.0, g: 0.15, b: 0.4 };    // Midnight blue
  const cPeak = { r: 0.6, g: 0.8, b: 1.0 };     // Ice white foam

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    
    // Calculate raw wave height
    let rawY = A1 * Math.sin(k1 * x + t * speed) * Math.cos(k1 * z * 0.8 + t * speed * 0.9)
             + A2 * Math.sin(k2 * x * 1.2 + t * speed * 1.1) * Math.cos(k2 * z + t * speed * 1.2)
             + A3 * Math.sin(k3 * x + t * speed * 1.4 + 2)
             + A4 * Math.cos(k4 * z + t * speed * 2 + x * 0.5);

    // FLATTEN WAVES UNDER BOAT
    // Boat is approx 4 units long, 1.5 wide. Radius ~2.5 covers it safely.
    const dx = x - boatX;
    const dz = z - boatZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    // Smoothstep mask: 0 inside radius 1.5, blends to 1 at radius 3.5
    let mask = (dist - 1.5) / 2.0;
    mask = Math.max(0, Math.min(1, mask));
    // Ease the mask
    mask = mask * mask * (3 - 2 * mask);
    
    // Apply mask to wave height (keep baseY, flatten the wave part)
    // We add a small depression (-0.2) under the boat so it sits IN the water, not just on flat water
    const hullDepression = (1 - mask) * -0.25; 
    const finalY = baseY[i] + (rawY * mask) + hullDepression;

    pos.setY(i, finalY);
    
    // Calculate color based on height relative to base
    // Note: Use rawY for color logic so the water under boat doesn't turn weird colors due to flattening
    const h = (rawY * mask); 
    
    // Smooth blending
    let r, g, b;
    if (h < 0.1) {
      // Blend Deep -> Mid
      const tMix = Math.min(1, Math.max(0, (h + 0.4) * 2.0)); 
      r = cDeep.r * (1 - tMix) + cMid.r * tMix;
      g = cDeep.g * (1 - tMix) + cMid.g * tMix;
      b = cDeep.b * (1 - tMix) + cMid.b * tMix;
    } else {
      // Blend Mid -> Peak (Foam)
      const tMix = Math.min(1, Math.max(0, (h - 0.1) * 3.5)); 
      r = cMid.r * (1 - tMix) + cPeak.r * tMix;
      g = cMid.g * (1 - tMix) + cPeak.g * tMix;
      b = cMid.b * (1 - tMix) + cPeak.b * tMix;
    }
    
    col.setXYZ(i, r, g, b);
  }
  
  pos.needsUpdate = true;
  col.needsUpdate = true;
  if (Math.floor(t * 8) % 2 === 0) geo.computeVertexNormals();
}

// ---------- Helper: Soft particle texture ----------
function createParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
  grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

// ---------- Splashes (Realistic spray using particles) ----------
function createSeaSplashes() {
  // Use Points for realistic spray instead of sphere meshes
  const count = 300;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = []; // Store velocity in CPU array
  const timers = [];     // Store life timer
  
  for(let i=0; i<count; i++) {
    positions[i*3] = 0;
    positions[i*3+1] = -10; // Hidden initially
    positions[i*3+2] = 0;
    velocities.push({x:0, y:0, z:0});
    timers.push(0);
  }
  
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const mat = new THREE.PointsMaterial({
    color: 0xaaddff,
    map: createParticleTexture(),
    size: 0.3,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  
  seaSplashes = new THREE.Points(geo, mat);
  seaSplashes.userData = { velocities, timers };
  boatSceneGroup.add(seaSplashes);
}

// ---------- Boat House & Dock (south) ----------
const flowerGeo = new THREE.SphereGeometry(0.06, 4, 4);
const flowerMats = [0xff69b4, 0xffb6c1, 0xffaa00, 0xdd88ff, 0xffffff].map(c => new THREE.MeshBasicMaterial({ color: c }));
function createFlowerPot(group, x, surfaceY, z) {
  const potH = 0.15;
  const potCenterY = surfaceY + potH / 2;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, potH, 6), new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 }));
  pot.position.set(x, potCenterY, z);
  group.add(pot);
  for (let i = 0; i < 4; i++) {
    const flower = new THREE.Mesh(flowerGeo, flowerMats[i % flowerMats.length]);
    flower.position.set(x + (Math.random() - 0.5) * 0.14, potCenterY + 0.06 + Math.random() * 0.1, z + (Math.random() - 0.5) * 0.14);
    group.add(flower);
  }
}
const bushGeo = new THREE.SphereGeometry(0.4, 5, 5);
const bushMat = new THREE.MeshStandardMaterial({ color: 0x228822, roughness: 0.95 });
const bushMatDark = new THREE.MeshStandardMaterial({ color: 0x1a5c1a, roughness: 0.95 });
const bushGlowGeo = new THREE.SphereGeometry(0.06, 3, 3);
const bushGlowMat = new THREE.MeshBasicMaterial({ color: 0xaaff88, transparent: true, opacity: 0.9 });
function createBush(group, x, z, surfaceY) {
  const halfHeight = 0.4 * 1.2;
  const bush = new THREE.Mesh(bushGeo, Math.random() > 0.5 ? bushMat : bushMatDark);
  bush.position.set(x, surfaceY + halfHeight, z);
  bush.scale.set(0.9 + Math.random() * 0.2, 1, 0.85 + Math.random() * 0.2);
  group.add(bush);
  const glow = new THREE.Mesh(bushGlowGeo, bushGlowMat);
  glow.position.set(0.1, 0.1, 0.05);
  bush.add(glow);
}

function createBoatHouse() {
  const houseGroup = new THREE.Group();
  const SZ = SOUTH_Z;
  const woodDarkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
  const woodPlankMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x221111, roughness: 0.6 });
  const windowGlowMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
  const railingMat = new THREE.MeshStandardMaterial({ color: 0x4a3c31, roughness: 0.9 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, 12), woodPlankMat);
  deck.position.set(0, 2, 25 + SZ);
  deck.receiveShadow = true;
  houseGroup.add(deck);

  [[-6, 20 + SZ], [6, 20 + SZ], [-6, 30 + SZ], [6, 30 + SZ], [-6, 25 + SZ], [6, 25 + SZ]].forEach(([x, z]) => {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 8, 8), woodDarkMat);
    s.position.set(x, -1, z);
    houseGroup.add(s);
  });

  const cabinGroup = new THREE.Group();
  cabinGroup.position.set(0, 2.2, 26 + SZ);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 8), woodPlankMat);
  walls.position.y = 2;
  walls.castShadow = true;
  cabinGroup.add(walls);
  [[-5.1, -4.1], [5.1, -4.1], [-5.1, 4.1], [5.1, 4.1]].forEach(([x, z]) => {
    cabinGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 0.6), woodDarkMat));
    cabinGroup.children[cabinGroup.children.length - 1].position.set(x, 2, z);
  });
  [[-2.5, 2.5, -4.1], [2.5, 2.5, -4.1]].forEach(([x, y, z]) => {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2, 0.2), woodDarkMat);
    frame.position.set(x, y, z);
    cabinGroup.add(frame);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.8), windowGlowMat);
    glass.position.set(x, y, z - 0.11);
    glass.rotation.y = Math.PI;
    cabinGroup.add(glass);
    const pl = new THREE.PointLight(0xffaa44, 2.5, 10);
    pl.position.set(x, y, z - 1);
    cabinGroup.add(pl);
  });
  const door = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.2), woodDarkMat);
  door.position.set(0, 1.5, -4.1);
  cabinGroup.add(door);
  const roofMain = new THREE.Mesh(new THREE.ConeGeometry(9, 3, 4), roofMat);
  roofMain.rotation.y = Math.PI / 4;
  roofMain.scale.set(1.4, 1, 1.1);
  roofMain.position.set(0, 5.5, 0);
  cabinGroup.add(roofMain);
  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(11, 0.2, 4), roofMat);
  porchRoof.position.set(0, 4.2, -4.5);
  porchRoof.rotation.x = -0.2;
  cabinGroup.add(porchRoof);
  [[-5, -6], [5, -6], [-2, -6], [2, -6]].forEach(([x, z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 8), woodDarkMat);
    post.position.set(x, 2, z);
    cabinGroup.add(post);
  });
  houseGroup.add(cabinGroup);

  const railLeft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 11), railingMat);
  railLeft.position.set(-6.9, 2.5, 25 + SZ);
  houseGroup.add(railLeft);
  const railRight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 11), railingMat);
  railRight.position.set(6.9, 2.5, 25 + SZ);
  houseGroup.add(railRight);

  const bridgeZStart = 19 + SZ;
  const bridgeZEnd = 1 + SZ;
  const basePlankGeo = new THREE.BoxGeometry(3, 0.15, 0.3);
  for (let i = 0; i < 50; i++) {
    const alpha = i / 50;
    const z = bridgeZStart - (bridgeZStart - bridgeZEnd) * alpha;
    const y = 2 - 1.8 * alpha;
    const p = new THREE.Mesh(basePlankGeo.clone(), woodPlankMat);
    p.position.set(0, y, z);
    p.rotation.x = -0.1;
    p.position.y += (Math.random() - 0.5) * 0.03;
    p.rotation.z = (Math.random() - 0.5) * 0.02;
    p.receiveShadow = true;
    houseGroup.add(p);
  }

  const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 8);
  const ropeCurvePtsL = [], ropeCurvePtsR = [];
  for (let i = 0; i <= 8; i++) {
    const alpha = i / 8;
    const y = 2 - 1.8 * alpha;
    const z = bridgeZStart - (bridgeZStart - bridgeZEnd) * alpha;
    [[-1.6, 0], [1.6, 1]].forEach(([x, side]) => {
      const p = new THREE.Mesh(postGeo, woodDarkMat);
      p.position.set(x, y + 0.6, z);
      p.rotation.x = -0.1;
      houseGroup.add(p);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.08), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8 }));
      crystal.position.set(0, 0.7, 0);
      p.add(crystal);
      const top = new THREE.Vector3(x, y + 1.1, z);
      if (side === 1) ropeCurvePtsR.push(top); else ropeCurvePtsL.push(top);
    });
  }

  const createRope = (pts) => {
    if (pts.length < 2) return null;
    const curvePath = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      const mid = p1.clone().add(p2).multiplyScalar(0.5);
      mid.y -= 0.2;
      curvePath.add(new THREE.QuadraticBezierCurve3(p1, mid, p2));
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curvePath, 64, 0.03, 6, false), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
    houseGroup.add(tube);
    return tube;
  };
  createRope(ropeCurvePtsL);
  createRope(ropeCurvePtsR);

  const fairyGeo = new THREE.SphereGeometry(0.05, 5, 5);
  const fairyMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  [ropeCurvePtsL, ropeCurvePtsR].forEach(pts => {
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i], p2 = pts[i + 1];
      for (let j = 1; j <= 2; j++) {
        const t = j / 3;
        const pos = new THREE.Vector3().lerpVectors(p1, p2, t);
        pos.y -= 0.2 * 4 * t * (1 - t);
        houseGroup.add(new THREE.Mesh(fairyGeo, fairyMat));
        houseGroup.children[houseGroup.children.length - 1].position.copy(pos);
      }
      const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
      mid.y -= 0.1;
      const pl = new THREE.PointLight(0xffffaa, 1.2, 5);
      pl.position.copy(mid);
      houseGroup.add(pl);
    }
  });

  const lanternGeo = new THREE.CylinderGeometry(0.15, 0.2, 0.4, 6);
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0xff4400, emissiveIntensity: 2 });
  [[-5, 22 + SZ], [5, 22 + SZ], [-5, 29 + SZ], [5, 29 + SZ]].forEach(([x, z]) => {
    houseGroup.add(new THREE.Mesh(lanternGeo, lanternMat));
    houseGroup.children[houseGroup.children.length - 1].position.set(x, 4.5, z);
    const pl = new THREE.PointLight(0xff6600, 2, 10);
    pl.position.set(x, 4, z);
    houseGroup.add(pl);
  });

  for (let u = -4; u <= 4; u += 2) {
    const pos = new THREE.Vector3(u, 6.2, 21.5 + SZ);
    houseGroup.add(new THREE.Mesh(fairyGeo, fairyMat));
    houseGroup.children[houseGroup.children.length - 1].position.copy(pos);
  }

  const deckSurfaceY = 2.2;
  const bridgeZHigh = 19 + SZ, bridgeZLow = 1 + SZ;
  const bridgeY = (z) => Math.max(0.25, 2 - 1.8 * (bridgeZHigh - z) / 18);
  createFlowerPot(houseGroup, -2, deckSurfaceY, 21.5 + SZ);
  createFlowerPot(houseGroup, 2, deckSurfaceY, 21.5 + SZ);
  createFlowerPot(houseGroup, -1, deckSurfaceY, 22.5 + SZ);
  createFlowerPot(houseGroup, 1, deckSurfaceY, 22.5 + SZ);
  createFlowerPot(houseGroup, -4.5, deckSurfaceY, 26 + SZ);
  createFlowerPot(houseGroup, 4.5, deckSurfaceY, 26 + SZ);
  createFlowerPot(houseGroup, -5.5, deckSurfaceY, 24 + SZ);
  createFlowerPot(houseGroup, 5.5, deckSurfaceY, 24 + SZ);
  createFlowerPot(houseGroup, -6, deckSurfaceY, 28 + SZ);
  createFlowerPot(houseGroup, 6, deckSurfaceY, 28 + SZ);

  const cabinWorldZ = 26 + SZ;
  const winBoxZ = cabinWorldZ - 4.2;
  [-2.5, 2.5].forEach((wx) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.2, 0.35), new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 }));
    box.position.set(wx, 2.3, winBoxZ);
    houseGroup.add(box);
    for (let f = 0; f < 6; f++) {
      const fl = new THREE.Mesh(flowerGeo, flowerMats[f % flowerMats.length]);
      fl.position.set(wx + (f % 3) * 0.7 - 0.7, 2.35, winBoxZ + (f < 3 ? 0.05 : -0.05));
      fl.scale.setScalar(0.8);
      houseGroup.add(fl);
    }
  });

  for (let z = 17 + SZ; z >= 3 + SZ; z -= 2.2) {
    createBush(houseGroup, -1.9, z, bridgeY(z));
    createBush(houseGroup, 1.9, z, bridgeY(z));
  }

  const tuftGeo = new THREE.SphereGeometry(0.15, 4, 4);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.95 });
  [[-6.5, 24 + SZ], [6.5, 24 + SZ], [-6.5, 26 + SZ], [6.5, 26 + SZ], [-5, 21 + SZ], [5, 21 + SZ]].forEach(([tx, tz]) => {
    const tuft = new THREE.Mesh(tuftGeo, tuftMat);
    tuft.position.set(tx, deckSurfaceY + 0.15, tz);
    tuft.scale.set(1, 1.3, 0.7);
    houseGroup.add(tuft);
  });

  scene.add(houseGroup);
}

// ---------- Boat on ocean: Romantic skiff (Casual & Romantic) ----------
function createBoatScene() {
  boatSceneGroup = new THREE.Group();
  createBoatHouse();
  createSea();
  createSeaSplashes();

  boatMovingGroup = new THREE.Group();
  boatMovingGroup.position.set(0, 0, BOAT_START_Z);

  const boat = new THREE.Group();
  
  // Materials
  const woodDarkMat = new THREE.MeshStandardMaterial({ 
    color: 0x5c3a2e, // Deep Mahogany
    roughness: 0.6, 
    metalness: 0.1 
  });
  const woodLightMat = new THREE.MeshStandardMaterial({ 
    color: 0xcfb997, // Warm Oak
    roughness: 0.8, 
    metalness: 0.0 
  });
  const woodFloorMat = new THREE.MeshStandardMaterial({ 
    color: 0xa68b6c, // Weathered Teak
    roughness: 0.9, 
    metalness: 0.0 
  });
  const cushionMat = new THREE.MeshStandardMaterial({ 
    color: 0x8a2be2, // Romantic Velvet (Blue-Violet/Burgundy mix)
    roughness: 1.0, 
    metalness: 0.0,
    emissive: 0x220033,
    emissiveIntensity: 0.2
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.3,
    metalness: 0.8
  });

  // 1. Hull Shell (Smooth oval shape, "Whitehall" style skiff)
  // Using a sphere bottom half, stretched
  const hullGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
  const hull = new THREE.Mesh(hullGeo, woodDarkMat);
  hull.scale.set(0.75, 0.6, 2.0); // W, H, L
  hull.position.set(0, 0.55, 0); // Lift so bottom is near water
  hull.castShadow = true;
  boat.add(hull);

  // 2. Inner Hull (Lining) - slightly smaller, lighter wood
  const innerHull = new THREE.Mesh(hullGeo, woodLightMat);
  innerHull.scale.set(0.72, 0.58, 1.95);
  innerHull.position.set(0, 0.56, 0);
  innerHull.material.side = THREE.DoubleSide; 
  boat.add(innerHull);

  // 3. Gunwale (Rim)
  const rimShape = new THREE.Shape();
  const rimLen = 2.0;
  const rimWid = 0.75;
  rimShape.absellipse(0, 0, rimWid, rimLen, 0, Math.PI * 2, false, 0);
  const rimHole = new THREE.Path();
  rimHole.absellipse(0, 0, rimWid - 0.08, rimLen - 0.08, 0, Math.PI * 2, false, 0);
  rimShape.holes.push(rimHole);
  
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
  const rim = new THREE.Mesh(rimGeo, woodDarkMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, 0.55, 0); // Top of hull
  rim.castShadow = true;
  boat.add(rim);

  // 4. Floor (Deck) — oval to match hull footprint (half-width 0.75, half-length 2.0)
  const ovalFloorGeo = new THREE.CylinderGeometry(1, 1, 0.05, 32);
  ovalFloorGeo.scale(0.5, 1, 1.5); // same proportions as hull/gunwale
  const ovalFloor = new THREE.Mesh(ovalFloorGeo, woodFloorMat);
  ovalFloor.position.set(0, 0.12, 0);
  ovalFloor.receiveShadow = true;
  boat.add(ovalFloor);

  // 5. Seats (Thwarts) with Cushions
  // Rear Seat
  const seatGeo = new THREE.BoxGeometry(1.2, 0.05, 0.4);
  const seatRear = new THREE.Mesh(seatGeo, woodLightMat);
  seatRear.position.set(0, 0.35, 0.8);
  boat.add(seatRear);

  // Rear Cushion
  const cushionR = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.35), cushionMat);
  cushionR.position.set(0, 0.41, 0.8);
  cushionR.castShadow = true;
  boat.add(cushionR);

  // Middle Seat
  const seatMid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.4), woodLightMat);
  seatMid.position.set(0, 0.35, -0.2);
  boat.add(seatMid);

  // Middle Cushion
  const cushionM = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.35), cushionMat);
  cushionM.position.set(0, 0.41, -0.2);
  cushionM.castShadow = true;
  boat.add(cushionM);

  // 6. Bow details (Lantern holder)
  const bowDeck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), woodLightMat);
  bowDeck.position.set(0, 0.5, -1.6);
  boat.add(bowDeck);

  // Lantern on bow
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(0, 0.53, -1.6);
  
  const lanternBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.05, 8), goldMat);
  lanternGroup.add(lanternBase);
  
  const lanternGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.6 })
  );
  lanternGlass.position.y = 0.15;
  lanternGroup.add(lanternGlass);
  
  const lanternTop = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.1, 8), goldMat);
  lanternTop.position.y = 0.3;
  lanternGroup.add(lanternTop);

  // Lantern Light
  const lanternLight = new THREE.PointLight(0xffaa00, 1.5, 5);
  lanternLight.position.y = 0.15;
  lanternGroup.add(lanternLight);
  
  boat.add(lanternGroup);

  // 7. Candles on seats/floor (Scatter them casually)
  const boatCandlesGroup = new THREE.Group();
  // Positions: [x, y, z] relative to boat center
  const candlePos = [
    [-0.4, 0.38, 0.8], // On rear seat
    [0.4, 0.38, 0.8],  // On rear seat
    [0, 0.15, 0.3],    // On floor
    [-0.3, 0.15, -0.7],// On floor
    [0.3, 0.38, -0.2]  // On middle seat
  ];

  candlePos.forEach(([x, y, z]) => {
    // Candle mesh
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0xfffff0, roughness: 0.4 })
    );
    wax.position.set(x, y + 0.06, z);
    boatCandlesGroup.add(wax);
    
    // Flame
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 4, 4),
      new THREE.MeshBasicMaterial({ color: 0xff6600 })
    );
    flame.position.set(x, y + 0.14, z);
    flame.userData.baseY = y + 0.14;
    boatCandlesGroup.add(flame);
    
    // Light
    const cl = new THREE.PointLight(0xff6600, 0.5, 2);
    cl.position.set(x, y + 0.2, z);
    boatCandlesGroup.add(cl);
  });
  
  boatCandlesGroup.userData.flames = boatCandlesGroup.children.filter(c => c.geometry && c.geometry.type === 'SphereGeometry');
  
  // Add boat first (children[0] for rocking animation)
  boat.position.set(0, -0.1, 0); 
  boat.userData.baseY = -0.1;
  boatMovingGroup.add(boat);

  // Add candles second (children[1] for flicker animation)
  boatMovingGroup.add(boatCandlesGroup);

  // Flyable lantern — appears after K, pick up / light / release to fly; reveals sweet message when it rises
  boatFlyableLantern = new THREE.Group();
  boatFlyableLantern.visible = false;
  boatFlyableLantern.position.set(0.32, 0.22, 0.45);
  const flyLanternMat = new THREE.MeshStandardMaterial({
    color: 0xffdd99,
    emissive: 0xffcc77,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const r = 0.08, h = 0.22;
  const flyBody = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 10), flyLanternMat);
  flyBody.position.y = h / 2;
  boatFlyableLantern.add(flyBody);
  const flyCap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, 0.06, 10), flyLanternMat);
  flyCap.position.y = h;
  boatFlyableLantern.add(flyCap);
  const flyBase = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, 0.025, 10), flyLanternMat);
  boatFlyableLantern.add(flyBase);
  boatFlyableLantern.userData.riseSpeed = 0.45;
  boatFlyableLantern.userData.wobbleT = 0;
  boatMovingGroup.add(boatFlyableLantern);

  // Bioluminescent sparkles around the boat (magical ocean)
  seaGlowGroup = new THREE.Group();
  // Tiny high-res specks instead of large spheres
  const glowGeo = new THREE.SphereGeometry(0.015, 8, 8); 
  for (let i = 0; i < 80; i++) {
    const p = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, // White hot core
      transparent: true,
      opacity: 0.9,
    }));
    p.position.set((Math.random() - 0.5) * 15, 0.05 + Math.random() * 0.2, (Math.random() - 0.5) * 15);
    p.userData.base = p.position.clone();
    p.userData.phase = Math.random() * Math.PI * 2;
    p.userData.speed = 0.3 + Math.random() * 0.5;
    
    // Add point light to some
    if (i % 8 === 0) {
      const pointLight = new THREE.PointLight(0x00ffff, 0.8, 3);
      pointLight.position.set(0, 0, 0);
      p.add(pointLight);
    }
    
    seaGlowGroup.add(p);
  }
  boatMovingGroup.add(seaGlowGroup);

  boatSceneGroup.add(boatMovingGroup);
  createTreasureChest();
  scene.add(boatSceneGroup);
}

// ---------- Realistic silver whistle — proper pea-whistle shape (chamber + mouthpiece) ----------
function createRealisticWhistle(mat) {
  const m = mat || new THREE.MeshStandardMaterial({
    color: 0xb8c4d0,
    roughness: 0.08,
    metalness: 0.98,
    emissive: 0x111822,
    emissiveIntensity: 0.03,
  });
  const g = new THREE.Group();
  // Axis: +X = mouthpiece end (you blow here), -X = chamber end. Y up, Z sideways.

  // 1. Sound chamber — rounded oval bulb (classic pea-whistle body)
  const chamber = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 28, 22, 0, Math.PI * 2, 0, Math.PI),
    m.clone()
  );
  chamber.scale.set(1.15, 1, 1.5);   // elongated along the whistle axis (Z in local = X in group)
  chamber.rotation.y = -Math.PI / 2;  // so long axis is along X
  chamber.position.set(-0.018, 0, 0);
  g.add(chamber);

  // 2. Mouthpiece — straight cylinder (the part you put to your lips)
  const mouthpiece = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.036, 24),
    m.clone()
  );
  mouthpiece.rotation.x = Math.PI / 2;
  mouthpiece.position.set(0.022, 0, 0);
  g.add(mouthpiece);

  // 3. Lip rim — rounded edge at the blow end
  const lipRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.01, 0.0025, 12, 28),
    m.clone()
  );
  lipRim.rotation.y = Math.PI / 2;
  lipRim.position.set(0.04, 0, 0);
  g.add(lipRim);

  // 4. Joint ring — where mouthpiece meets chamber
  const jointRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.012, 0.002, 10, 28),
    m.clone()
  );
  jointRing.rotation.y = Math.PI / 2;
  jointRing.position.set(0.002, 0, 0);
  g.add(jointRing);

  // 5. Sound window — rectangular slot on top of chamber (where sound exits)
  const slotMat = new THREE.MeshStandardMaterial({
    color: 0x181c24,
    roughness: 0.95,
    metalness: 0.2,
  });
  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.005, 0.012),
    slotMat
  );
  slot.position.set(-0.018, 0.02, 0);
  slot.rotation.y = Math.PI / 2;
  g.add(slot);

  // 6. Pea (tiny ball inside, visible through window — classic pea-whistle detail)
  const peaMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a,
    roughness: 0.7,
    metalness: 0.1,
  });
  const pea = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 10), peaMat);
  pea.position.set(-0.018, 0.014, 0);
  g.add(pea);

  // 7. Subtle highlight (catch light on chamber)
  const highlightMat = new THREE.MeshStandardMaterial({
    color: 0xd0dce8,
    roughness: 0.05,
    metalness: 0.98,
  });
  const highlight = new THREE.Mesh(
    new THREE.RingGeometry(0.018, 0.022, 16, 1, 0, Math.PI * 0.7),
    highlightMat
  );
  highlight.rotation.x = -Math.PI / 2;
  highlight.rotation.z = Math.PI / 2;
  highlight.position.set(-0.025, 0.008, 0.018);
  g.add(highlight);

  return g;
}

// ---------- Treasure: pink chest on map, sky light, pick up in boat, open for silver whistle ----------
function createTreasureChest() {
  const group = new THREE.Group();
  group.position.set(TREASURE_X, 0, TREASURE_Z);

  // Small wooden platform so chest sits above water
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x6b4423,
    roughness: 0.85,
    metalness: 0.05,
  });
  const platform = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 1.8), platformMat);
  platform.position.y = 0.08;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);

  // Pink treasure chest - highly detailed
  const pinkMain = new THREE.MeshStandardMaterial({
    color: 0xe75480,
    roughness: 0.5,
    metalness: 0.05,
    emissive: 0x330011,
    emissiveIntensity: 0.08,
  });
  const pinkDark = new THREE.MeshStandardMaterial({
    color: 0xc73e6b,
    roughness: 0.55,
    metalness: 0.05,
  });
  const goldMat = new THREE.MeshStandardMaterial({
    color: 0xffd700,
    roughness: 0.25,
    metalness: 0.9,
    emissive: 0x332200,
    emissiveIntensity: 0.05,
  });
  const silverMat = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    roughness: 0.2,
    metalness: 0.95,
  });

  // Chest body (rounded by using a slightly scaled box + bevel feel via extra bands)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.55), pinkMain);
  body.position.y = 0.28;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Front band (strap)
  const bandF = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.12), goldMat);
  bandF.position.set(0, 0.28, 0.28);
  group.add(bandF);
  const bandR = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.12), goldMat);
  bandR.position.set(0, 0.28, -0.28);
  group.add(bandR);
  const bandL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.56), goldMat);
  bandL.position.set(-0.46, 0.28, 0);
  group.add(bandL);
  const bandRt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.56), goldMat);
  bandRt.position.set(0.46, 0.28, 0);
  group.add(bandRt);

  // Lock plate and lock
  const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.06), goldMat);
  lockPlate.position.set(0, 0.28, 0.32);
  group.add(lockPlate);
  const lockCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), goldMat);
  lockCyl.rotation.z = Math.PI / 2;
  lockCyl.position.set(0, 0.28, 0.35);
  group.add(lockCyl);

  // Lid hinged at FRONT (edge away from player) so it swings BACK and opens toward you
  const lidGroup = new THREE.Group();
  lidGroup.position.set(0, 0.56, -0.26);  // hinge at front edge of lid (away from player)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.12, 0.52), pinkDark);
  lid.position.set(0, 0, 0.26);   // lid center: back half of lid (toward player) swings up
  lid.castShadow = true;
  lidGroup.add(lid);
  const lidBand = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.1), goldMat);
  lidBand.position.set(0, 0, 0.26);
  lidGroup.add(lidBand);
  group.add(lidGroup);

  // Corner reinforcements (rivets)
  const rivetGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8);
  [[-0.44, 0.28, 0.26], [0.44, 0.28, 0.26], [-0.44, 0.28, -0.26], [0.44, 0.28, -0.26]].forEach(([x, y, z]) => {
    const r = new THREE.Mesh(rivetGeo, goldMat);
    r.position.set(x, y, z);
    group.add(r);
  });

  // Realistic silver whistle inside (visible when opened)
  const whistle = createRealisticWhistle(silverMat);
  whistle.position.set(0, 1, 0);
  whistle.visible = false;
  whistle.userData.isWhistle = true;
  group.add(whistle);
  group.userData.whistleMesh = whistle;
  group.userData.lidMesh = lidGroup;

  treasureChestGroup = group;
  boatSceneGroup.add(group);

  // Copy of chest to show in boat when picked up (in front of player, on floor)
  const chestCopy = group.clone(true);
  chestCopy.remove(chestCopy.children[0]); // remove platform
  chestCopy.position.set(0, 0.12, 0.28);   // boat space: on floor, just in front of player (seat at z=0.8)
  chestCopy.scale.setScalar(0.65);
  chestCopy.visible = false;
  boatChestLid = chestCopy.children[7];   // lid mesh for open animation
  boatChestWhistle = chestCopy.children[chestCopy.children.length - 1]; // whistle group inside
  if (boatChestWhistle) {
    boatChestWhistle.visible = false; // show when chest opens
    boatChestWhistle.scale.setScalar(0.45);          // tiny, real whistle size
    boatChestWhistle.position.set(0, 0.58, 0);       // on top of the chest (above the cuboid body)
    // Magical silver glow so it stands out
    boatChestWhistle.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color(0x88aacc);
        o.material.emissiveIntensity = 0.35;
      }
    });
  }
  boatChestGroup = chestCopy;
  boatMovingGroup.add(chestCopy);

  // Visible light stream from sky to chest (cone beam) - visible from anywhere on the map
  const beamHeight = TREASURE_BEAM_HEIGHT - 0.2;
  const beamGeo = new THREE.CylinderGeometry(0.8, 6, beamHeight, 16, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffeedd,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  treasureLightStreamMesh = new THREE.Mesh(beamGeo, beamMat);
  treasureLightStreamMesh.position.set(TREASURE_X, beamHeight / 2 + 0.1, TREASURE_Z);
  treasureLightStreamMesh.visible = false;
  scene.add(treasureLightStreamMesh);

  // Strong spotlight from the sky onto the treasure — shown 5 seconds after boarding
  treasureSpotLight = new THREE.SpotLight(0xffeedd, 0, 60, Math.PI / 6, 0.2, 1.2);
  treasureSpotLight.position.set(TREASURE_X, TREASURE_BEAM_HEIGHT, TREASURE_Z);
  treasureSpotLight.target.position.set(TREASURE_X, 0.15, TREASURE_Z);
  treasureSpotLight.castShadow = true;
  treasureSpotLight.shadow.mapSize.width = 512;
  treasureSpotLight.shadow.mapSize.height = 512;
  scene.add(treasureSpotLight);
  scene.add(treasureSpotLight.target);
}

// ---------- Gold dust when chest disappears ----------
function spawnGoldDust(worldPos) {
  const count = 120;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = worldPos.x + (Math.random() - 0.5) * 0.8;
    positions[i * 3 + 1] = worldPos.y + Math.random() * 0.4;
    positions[i * 3 + 2] = worldPos.z + (Math.random() - 0.5) * 0.8;
    velocities.push({
      x: (Math.random() - 0.5) * 2,
      y: 0.8 + Math.random() * 1.5,
      z: (Math.random() - 0.5) * 2,
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffd700,
    map: createParticleTexture(),
    size: 0.25,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  goldDustPoints = new THREE.Points(geo, mat);
  goldDustPoints.userData = { velocities, startTime: performance.now() };
  scene.add(goldDustPoints);
}

// ---------- Whistle in front of camera (as if blowing) — same realistic model ----------
function addWhistleInHand() {
  const handMat = new THREE.MeshStandardMaterial({
    color: 0xb8c4d0,
    roughness: 0.06,
    metalness: 0.98,
    emissive: 0x182028,
    emissiveIntensity: 0.04,
  });
  const g = createRealisticWhistle(handMat);
  g.position.set(0, -0.06, -0.26);  // in front of your mouth (mouth height, slightly below center)
  g.rotation.set(0.05, Math.PI / 2, 0);  // mouthpiece toward camera so it's at your lips
  g.scale.setScalar(0.48);         // real whistle size (~4–5 cm)
  whistleInHand = g;
  camera.add(g);
}

// ---------- Stars (night sky full of stars - Tangled style) ----------
function createStars() {
  starsGroup = new THREE.Group();
  const starGeo = new THREE.BufferGeometry();
  const positions = [];
  const rand = () => (Math.random() - 0.5) * 2;
  for (let i = 0; i < 1200; i++) {
    positions.push(rand() * 100, 15 + Math.random() * 60, rand() * 100);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({
    size: 0.4,
    color: 0xfff5e6,
    transparent: true,
    opacity: 0.95,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  starsGroup.add(stars);
  scene.add(starsGroup);

  // Star message - appears in sky directly below moon after whistle/K
  starMessageGroup = new THREE.Group();
  starMessageGroup.visible = false;
  starMessageGroup.position.set(0, 62, -178);
  scene.add(starMessageGroup);

  // Sweet message for Jaanu — appears when flyable lantern flies; placed below valentine text in sky
  sweetMessageGroup = new THREE.Group();
  sweetMessageGroup.visible = false;
  sweetMessageGroup.position.set(0, 44, -175);
  scene.add(sweetMessageGroup);
}

// ---------- Surreal scene: large-scale continuous lanterns + proper heart balloons + continuous fireworks ----------
function createHeartShape(size) {
  // Proper heart silhouette: 2D shape from parametric heart curve, extruded
  const shape = new THREE.Shape();
  const scale = size / 16;
  for (let i = 0; i <= 32; i++) {
    const t = (i / 32) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    if (i === 0) shape.moveTo(x * scale, y * scale);
    else shape.lineTo(x * scale, y * scale);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: size * 0.25, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02 });
  const mat = new THREE.MeshStandardMaterial({ color: 0xff4466, emissive: 0xff1144, emissiveIntensity: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = 0;
  mesh.scale.set(1, 1, 1);
  return mesh;
}

function createRisingLights() {
  balloonsGroup = new THREE.Group();
  lanternsGroup = new THREE.Group();
  candlesGroup = new THREE.Group();

  // Lanterns — fantasy palette: warm golds, soft magentas, teals, lavenders
  const lampColors = [
    0xffdd99, 0xffaa66, 0xffcc88, 0xffb366, 0xffeedd, 0xffc080,
    0xff9966, 0xffcc99, 0xffe4b5, 0xffda9e, 0xf0e68c, 0xfff0b5,
    0xffb380, 0xffd699, 0xffecb3, 0xfff5e6, 0xffdfba, 0xffe4c4,
    0xe8b4ff, 0xc9a0dc, 0xb8a9e8, 0xa8d4ff, 0x98f5e8, 0xffb3e6,
    0xffd1dc, 0xdda0dd, 0xbfefff, 0x98fb98, 0xfff0f5, 0xe6e6fa,
  ];
  const LANTERN_SCALE = 1.7;
  const LANTERN_FESTIVAL_COUNT = 1280;
  for (let i = 0; i < LANTERN_FESTIVAL_COUNT; i++) {
    const lamp = new THREE.Group();
    const color = lampColors[Math.floor(Math.random() * lampColors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.15,
      roughness: 0.3,
    });
    const r = (0.14 + Math.random() * 0.1) * LANTERN_SCALE;
    const h = (0.32 + Math.random() * 0.18) * LANTERN_SCALE;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, h, 10), mat);
    body.position.y = h / 2;
    lamp.add(body);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, 0.07 * LANTERN_SCALE, 10), mat);
    cap.position.y = h;
    lamp.add(cap);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.9, 0.035 * LANTERN_SCALE, 10), mat);
    lamp.add(base);
    lamp.userData.riseSpeed = 0.5 + Math.random() * 0.4;
    lamp.userData.wobble = Math.random() * 0.02;
    lamp.position.set(0, 0, 0);
    lanternsGroup.add(lamp);
  }

  // Heart balloons — wide fantasy palette: pinks, roses, golds, lavenders, mints, corals, violets
  const heartColors = [
    0xff6b9d, 0xff1493, 0xff69b4, 0xff85a2, 0xe91e63, 0xf48fb1, 0xffb6c1, 0xff4081, 0xc2185b, 0xff80ab,
    0xffd700, 0xffaa00, 0xffec8b, 0xdaa520, 0xfff0b5, 0xe8b4ff, 0xc9a0dc, 0xba55d3, 0x9370db, 0x8a2be2,
    0x98fb98, 0x7fffd4, 0x00fa9a, 0x98f5e8, 0xafeeee, 0xffb347, 0xff7f50, 0xffa07a, 0xff6347, 0xffcccb,
    0xff69b4, 0xff1493, 0xffc0cb, 0xdc143c, 0xff6b8a, 0xf0e68c, 0xffe4b5, 0xfff8dc,
  ];
  for (let i = 0; i < 380; i++) {
    const heart = createHeartShape(0.2 + Math.random() * 0.16);
    const col = heartColors[Math.floor(Math.random() * heartColors.length)];
    heart.material = heart.material.clone();
    heart.material.color.setHex(col);
    heart.material.emissive.setHex(col);
    heart.material.emissiveIntensity = 0.7 + Math.random() * 0.35;
    heart.userData.riseSpeed = 0.5 + Math.random() * 0.45;
    heart.userData.wobble = Math.random() * 0.02;
    heart.position.set(0, 0, 0);
    heart.rotation.x = (Math.random() - 0.5) * 0.2;
    heart.rotation.y = Math.random() * Math.PI * 2;
    heart.rotation.z = (Math.random() - 0.5) * 0.2;
    balloonsGroup.add(heart);
  }

  // Floating fantasy decorations — stars and crystals rising with lanterns
  decorationsGroup = new THREE.Group();
  const decoColors = [
    0xffd700, 0xffec8b, 0xe8b4ff, 0xc9a0dc, 0x98fb98, 0x7fffd4, 0xffb6c1, 0xffaa00,
    0xbfefff, 0xdda0dd, 0x98f5e8, 0xfff0b5, 0xffb347, 0xda70d6, 0x87ceeb, 0xf0e68c,
  ];
  for (let i = 0; i < 220; i++) {
    const isStar = Math.random() > 0.5;
    const col = decoColors[Math.floor(Math.random() * decoColors.length)];
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.6 + Math.random() * 0.5,
      roughness: 0.3,
    });
    let mesh;
    if (isStar) {
      const starGeo = new THREE.OctahedronGeometry(0.12 + Math.random() * 0.08, 0);
      mesh = new THREE.Mesh(starGeo, mat);
      mesh.scale.set(1, 1, 0.3);
    } else {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.1 + Math.random() * 0.06, 0), mat);
    }
    mesh.userData.riseSpeed = 0.45 + Math.random() * 0.5;
    mesh.userData.wobble = Math.random() * 0.02;
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * 0.3);
    decorationsGroup.add(mesh);
  }

  balloonsGroup.visible = false;
  lanternsGroup.visible = false;
  decorationsGroup.visible = false;
  candlesGroup.visible = false;
  scene.add(balloonsGroup);
  scene.add(lanternsGroup);
  scene.add(decorationsGroup);
  scene.add(candlesGroup);
}

// ---------- Fireworks — everywhere, all directions, festival climax ----------
const FIREWORK_SPREAD = 90;
const LANTERN_CLUSTER_SIZE = 16;
const LANTERN_CLUSTER_SPREAD = 11;
const LANTERN_RESPAWN_RADIUS = 11;
function createFireworks() {
  fireworksGroup = new THREE.Group();
  const fireworkColors = [0xffaa44, 0xff6b9d, 0x98d8aa, 0xffdd99, 0xc9a0dc, 0xffb347, 0xff69b4, 0x00e5ff, 0xffeb3b];
  const numBursts = 22;
  for (let burst = 0; burst < numBursts; burst++) {
    const bx = (Math.random() - 0.5) * FIREWORK_SPREAD * 2;
    const by = 10 + burst * 2.5 + Math.random() * 12;
    const bz = (Math.random() - 0.5) * FIREWORK_SPREAD * 2;
    for (let i = 0; i < 52; i++) {
      const geo = new THREE.SphereGeometry(0.07, 6, 6);
      const color = fireworkColors[burst % fireworkColors.length];
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
      const p = new THREE.Mesh(geo, mat);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 2.8 + Math.random() * 1.8;
      p.userData.vx = Math.sin(phi) * Math.cos(theta) * speed;
      p.userData.vy = Math.cos(phi) * speed;
      p.userData.vz = Math.sin(phi) * Math.sin(theta) * speed;
      p.userData.life = 1;
      p.userData.burstIndex = burst;
      p.userData.center = new THREE.Vector3(bx, by, bz);
      p.userData.launched = false;
      p.position.set(bx, by, bz);
      p.visible = false;
      fireworksGroup.add(p);
    }
  }
  fireworksGroup.visible = false;
  scene.add(fireworksGroup);
}

// ---------- Candle sparkles (golden particles around boat) ----------
function createSparkles() {
  sparklesGroup = new THREE.Group();
  const sparkleGeo = new THREE.SphereGeometry(0.04, 4, 4);
  for (let i = 0; i < 80; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffdd88,
      transparent: true,
      opacity: 0,
    });
    const s = new THREE.Mesh(sparkleGeo, mat);
    s.position.set((Math.random() - 0.5) * 8, 0.5 + Math.random() * 3, (Math.random() - 0.5) * 6);
    s.userData.phase = Math.random() * Math.PI * 2;
    s.userData.speed = 2 + Math.random() * 2;
    s.userData.radius = 0.5 + Math.random() * 1.5;
    s.userData.center = s.position.clone();
    s.userData.active = false;
    sparklesGroup.add(s);
  }
  sparklesGroup.visible = false;
  scene.add(sparklesGroup);
}

// ---------- Fireflies (around the boat) ----------
function createFireflies() {
  firefliesGroup = new THREE.Group();
  const fireflyGeo = new THREE.SphereGeometry(0.06, 4, 4);
  const fireflyMat = new THREE.MeshBasicMaterial({
    color: 0xb8ff80,
    transparent: true,
    opacity: 0.9,
  });
  for (let i = 0; i < 50; i++) {
    const f = new THREE.Mesh(fireflyGeo, fireflyMat);
    f.position.set((Math.random() - 0.5) * 12, 0.5 + Math.random() * 4, (Math.random() - 0.5) * 12);
    f.userData.phase = Math.random() * Math.PI * 2;
    f.userData.speed = 0.5 + Math.random() * 1;
    f.userData.radius = 1.5 + Math.random() * 3;
    f.userData.center = f.position.clone();
    f.visible = false;
    firefliesGroup.add(f);
  }
  scene.add(firefliesGroup);
}

// ---------- Magic flower "named after you" ----------
function createMagicFlower() {
  const g = new THREE.Group();
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.04, 0.5, 6);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
  const stem = new THREE.Mesh(stemGeo, stemMat);
  stem.position.y = 0.25;
  g.add(stem);

  const petalGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xff69b4,
    emissive: 0xff1493,
    emissiveIntensity: 0.3,
  });
  const petal = new THREE.Mesh(petalGeo, petalMat);
  petal.position.y = 0.5;
  petal.scale.setScalar(0);
  g.add(petal);

  g.position.set(0.6, 0.4, 0.35);
  g.rotation.y = -0.3;
  g.visible = false;
  g.userData.petal = petal;
  magicFlower = g;
  boatMovingGroup.add(g);
}

// ---------- Star message: "Will you be my Valentine?" below moon, cursive writing animation ----------
function createStarMessageTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);

  starMessageGroup.userData.starCanvas = canvas;
  starMessageGroup.userData.starCtx = ctx;
  starMessageGroup.userData.starTex = tex;
  starMessageGroup.userData.writeProgress = 0;
  starMessageGroup.userData.nameMesh = null;

  const geo = new THREE.PlaneGeometry(50, 10);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
  });
  starMessageText = new THREE.Mesh(geo, mat);
  starMessageText.position.z = 0;
  starMessageGroup.add(starMessageText);
}

function drawStarMessage(progress) {
  const canvas = starMessageGroup?.userData.starCanvas;
  const ctx = starMessageGroup?.userData.starCtx;
  const tex = starMessageGroup?.userData.starTex;
  if (!canvas || !ctx || !tex) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '400 84px "Great Vibes"';
  ctx.fillStyle = 'rgba(255, 250, 240, 0.98)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (progress < 1) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w * progress, h);
    ctx.clip();
  }
  ctx.fillText('Will you be my Valentine?', w / 2, h / 2);
  if (progress < 1) ctx.restore();
  tex.needsUpdate = true;
}

// ---------- Long sweet message for Jaanu (when lantern flies — appears below "Will you be my Valentine?") ----------
function createSweetMessageTexture() {
  const lines = [
    'Jaanu, you light up my world.',
    'Every moment with you feels like magic —',
    'like lanterns in the sky and wishes coming true.',
    'We\'ll remove all the sadness and let it go like these lanterns.',
    'I\'m so grateful for your love, your smile,',
    'and the way you make every day special.',
    'You are my favourite person, my home, my joy.',
    'I love you forever and always.',
    'Happy Valentine\'s Day, my love. 💕'
  ];
  const lineHeight = 68;
  const canvasW = 1000;
  const canvasH = lines.length * lineHeight + 100;
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.font = 'italic 52px "Cormorant Garamond"';
  ctx.fillStyle = 'rgba(255, 248, 235, 0.96)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const startY = canvasH / 2 - (lines.length * lineHeight) / 2 + lineHeight / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, canvasW / 2, startY + i * lineHeight);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const aspect = canvasW / canvasH;
  const planeH = 32;
  const planeW = planeH * aspect;
  const geo = new THREE.PlaneGeometry(planeW, planeH);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
  });
  sweetMessageText = new THREE.Mesh(geo, mat);
  sweetMessageText.position.z = 0;
  sweetMessageGroup.add(sweetMessageText);
}

// ---------- Whistle detection ----------
let audioContext = null;
let analyser = null;
let micStream = null;
let whistleHistory = [];
const WHISTLE_THRESHOLD = 0.35;
const WHISTLE_HISTORY_LENGTH = 25;

async function initMicrophone() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);
    return true;
  } catch (e) {
    console.warn('Microphone not available:', e);
    return false;
  }
}

function checkWhistle() {
  if (!analyser || state.whistleDetected) return false;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  // Whistle: energy in ~1–4 kHz (bins ~20–80 for 2048 fft, 44.1k)
  let sum = 0;
  const low = 15;
  const high = 90;
  for (let i = low; i < high; i++) sum += data[i];
  const avg = sum / (high - low);
  const normalized = avg / 255;
  whistleHistory.push(normalized);
  if (whistleHistory.length > WHISTLE_HISTORY_LENGTH) whistleHistory.shift();
  const sustained = whistleHistory.length >= WHISTLE_HISTORY_LENGTH
    && whistleHistory.every(v => v > WHISTLE_THRESHOLD * 0.7);
  if (sustained && normalized > WHISTLE_THRESHOLD) {
    state.whistleDetected = true;
    return true;
  }
  return false;
}

// ---------- Reveal magic: on K — text disappears, lanterns float (Tangled), audio plays ----------
let lanternsRiseStartTime = null;
let magicAudio = null;
let lastContinuousFireworkTime = 0;

function revealMagic() {
  state.magicRevealed = true;
  if (hint) { hint.classList.add('hidden'); hint.textContent = ''; }
  prompt.classList.add('hidden');
  prompt.textContent = '';

  starMessageGroup.visible = true;
  starMessageGroup.userData.animating = true;

  if (boatFlyableLantern) boatFlyableLantern.visible = true;

  // Lantern festival — huge perimeter, dense groups everywhere (cluster spawn)
  const FESTIVAL_RADIUS = 95;
  const FESTIVAL_DEPTH = 55;
  const LANTERN_BOAT_RADIUS = 11;
  if (lanternsGroup && boatMovingGroup) {
    const boat = boatMovingGroup.position;
    let cx = 0, cy = 0, cz = 0;
    lanternsGroup.children.forEach((lamp, i) => {
      if (i % LANTERN_CLUSTER_SIZE === 0) {
        cx = boat.x + (Math.random() - 0.5) * LANTERN_BOAT_RADIUS * 2;
        cy = boat.y - 8 - Math.random() * 22;
        cz = boat.z + (Math.random() - 0.5) * LANTERN_BOAT_RADIUS * 2;
      }
      lamp.position.set(
        cx + (Math.random() - 0.5) * LANTERN_CLUSTER_SPREAD * 2,
        cy + (Math.random() - 0.5) * 8,
        cz + (Math.random() - 0.5) * LANTERN_CLUSTER_SPREAD * 2
      );
    });
    lanternsGroup.visible = true;
    lanternsRiseStartTime = performance.now();
  }
  if (balloonsGroup && boatMovingGroup) {
    const boat = boatMovingGroup.position;
    balloonsGroup.children.forEach((heart) => {
      heart.position.set(
        boat.x + (Math.random() - 0.5) * FESTIVAL_RADIUS * 2,
        boat.y - 10 - Math.random() * (FESTIVAL_DEPTH - 10),
        boat.z + (Math.random() - 0.5) * FESTIVAL_RADIUS * 2
      );
    });
    balloonsGroup.visible = true;
  }
  if (decorationsGroup && boatMovingGroup) {
    const boat = boatMovingGroup.position;
    decorationsGroup.children.forEach((dec) => {
      dec.position.set(
        boat.x + (Math.random() - 0.5) * FESTIVAL_RADIUS * 2,
        boat.y - 14 - Math.random() * FESTIVAL_DEPTH,
        boat.z + (Math.random() - 0.5) * FESTIVAL_RADIUS * 2
      );
    });
    decorationsGroup.visible = true;
  }
  // Fireworks — everywhere (spread across sky), all directions
  if (fireworksGroup) {
    fireworksGroup.visible = true;
    lastContinuousFireworkTime = performance.now();
    for (let idx = 0; idx < 22; idx++) {
      setTimeout(() => {
        if (fireworksGroup?.children) {
          fireworksGroup.children.forEach((p) => {
            if (p.userData && p.userData.burstIndex === idx) p.userData.launched = true;
          });
        }
      }, idx * 420 + Math.random() * 200);
    }
  }

  // Play audio.mp3
  try {
    magicAudio = new Audio('audio.mp3');
    magicAudio.volume = 0.8;
    magicAudio.play().catch(() => {});
  } catch (_) {}

  setTimeout(() => {
    if (magicFlower) {
      magicFlower.visible = true;
      magicFlower.userData.bloom = true;
    }
  }, 2000);

  setTimeout(() => {
    flowerTag.classList.remove('hidden');
  }, 3500);
}



// ---------- Moon (visible from anywhere, single soft glow) ----------
function createMoon() {
  const moonGeo = new THREE.SphereGeometry(12, 24, 24);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.position.set(0, 80, -180);
  scene.add(moonMesh);
  
  moonLight = new THREE.DirectionalLight(0xe8eeff, 2.0);
  moonLight.position.copy(moonMesh.position);
  moonLight.target.position.set(0, 0, 0);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.width = 1024;
  moonLight.shadow.mapSize.height = 1024;
  moonLight.shadow.camera.near = 50;
  moonLight.shadow.camera.far = 400;
  moonLight.shadow.camera.left = -50;
  moonLight.shadow.camera.right = 50;
  moonLight.shadow.camera.top = 50;
  moonLight.shadow.camera.bottom = -50;
  moonLight.shadow.bias = -0.0001;
  scene.add(moonLight);
  scene.add(moonLight.target);
}

// ---------- Lighting ----------
function createLights() {
  ambientLight = new THREE.AmbientLight(0x1a2244, 0.25);
  scene.add(ambientLight);
  hemisphereLight = new THREE.HemisphereLight(0x2a3055, 0x0a1520, 0.3);
  scene.add(hemisphereLight);
  createMoon();
  const fill = new THREE.DirectionalLight(0x8899bb, 0.1);
  fill.position.set(-15, 15, 20);
  scene.add(fill);
}

// ---------- Scene visibility (boat + sea always; magic elements on whistle) ----------
function showBoatScene() {
  boatSceneGroup.visible = true;
  starsGroup.visible = true;
  if (starMessageGroup) starMessageGroup.visible = state.magicRevealed;
  if (magicFlower) magicFlower.visible = state.magicRevealed;
  if (flowerTag) flowerTag.classList.toggle('hidden', !state.magicRevealed);
  scene.background.set(0x050308);
  scene.fog.color.set(0x0a1620);
}

// ---------- Start ----------
function onStart() {
  startOverlay.classList.add('hidden');
  createLights();
  createBoatScene();
  createStars();
  createStarMessageTexture();
  createSweetMessageTexture();
  createMagicFlower();
  createRisingLights();
  createFireworks();
  showBoatScene();
  initMicrophone();
  requestAnimationFrame(animate);
}

// ---------- Input ----------
const keys = { w: false, a: false, s: false, d: false, g: false, e: false };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = true;
  if (e.key === 'ArrowUp') { keys.w = true; e.preventDefault(); }
  if (e.key === 'ArrowDown') { keys.s = true; e.preventDefault(); }
  if (e.key === 'ArrowLeft') { keys.a = true; e.preventDefault(); }
  if (e.key === 'ArrowRight') { keys.d = true; e.preventDefault(); }
  if (k === 'k' && state.inBoat && (!state.whistleDetected || state.hasSilverWhistle)) {
    e.preventDefault();
    state.whistleDetected = true;
    revealMagic();
  }
  if (k === 'g' && !state.inBoat) {
    const dist = camera.position.distanceTo(new THREE.Vector3(0, 0.5, BOAT_START_Z));
    if (dist < 5.0) enterBoat();
  }
  // E: pick up treasure chest (when near in boat) or open chest (after picked)
  if (k === 'e') {
    if (state.inBoat && boatMovingGroup && !state.treasureChestPickedUp) {
      const bx = boatMovingGroup.position.x, bz = boatMovingGroup.position.z;
      const dist = Math.sqrt((TREASURE_X - bx) ** 2 + (TREASURE_Z - bz) ** 2);
      if (dist < TREASURE_PICKUP_RANGE) {
        e.preventDefault();
        state.treasureChestPickedUp = true;
        if (treasureChestGroup) treasureChestGroup.visible = false;
        if (boatChestGroup) boatChestGroup.visible = true;  // place chest in boat in front of player
        if (treasureSpotLight) treasureSpotLight.intensity = 0;
        if (treasureLightStreamMesh) treasureLightStreamMesh.visible = false;
        prompt.textContent = 'Press E to open the chest';
        prompt.classList.remove('hidden');
      }
    } else if (state.inBoat && state.treasureChestPickedUp && !state.treasureChestOpened) {
      e.preventDefault();
      state.treasureChestOpened = true;
      prompt.textContent = 'Press E to take the silver whistle';
      prompt.classList.remove('hidden');
    } else if (state.inBoat && state.treasureChestPickedUp && state.treasureChestOpened && !state.hasSilverWhistle) {
      e.preventDefault();
      state.hasSilverWhistle = true;
      // Whistle appears in front of camera (blowing pose); chest disappears as gold dust
      if (boatChestGroup) {
        boatChestGroup.getWorldPosition(_chestWorldPos);
        spawnGoldDust(_chestWorldPos);
        boatChestGroup.visible = false;
      }
      addWhistleInHand();
      prompt.textContent = 'You have the silver whistle! Press K or whistle for magic.';
      prompt.classList.remove('hidden');
    } else if (state.inBoat && state.magicRevealed && boatFlyableLantern && boatFlyableLantern.parent === boatMovingGroup) {
      e.preventDefault();
      boatFlyableLantern.removeFromParent();
      scene.add(boatFlyableLantern);
      state.boatLanternHeld = true;
      prompt.textContent = 'Press E to light and release the lantern';
      prompt.classList.remove('hidden');
    } else if (state.inBoat && state.boatLanternHeld) {
      e.preventDefault();
      state.boatLanternHeld = false;
      state.boatLanternFlying = true;
      camera.getWorldDirection(_dir);
      boatFlyableLantern.position.copy(camera.position).addScaledVector(_dir, 0.7);
      boatFlyableLantern.position.y += 0.25;
      boatFlyableLantern.userData.wobbleT = 0;
      boatFlyableLantern.userData.releaseTime = performance.now();
      prompt.textContent = 'W/S or ↑/↓ = row · A/D or ←/→ = turn · Drag to look · K or whistle for magic';
      prompt.classList.remove('hidden');
    }
  }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keys) keys[k] = false;
  if (e.key === 'ArrowUp') keys.w = false;
  if (e.key === 'ArrowDown') keys.s = false;
  if (e.key === 'ArrowLeft') keys.a = false;
  if (e.key === 'ArrowRight') keys.d = false;
});

// Touch / mobile move (simplified: tap left/right to turn, forward to walk)
let touchStartX = 0;
canvas.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
canvas.addEventListener('touchend', (e) => {
  if (e.changedTouches[0]) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 30) controls.target.x -= Math.sign(dx) * 3;
  }
}, { passive: true });

function enterBoat() {
  state.inBoat = true;
  prompt.textContent = 'W/S or ↑/↓ = row · A/D or ←/→ = turn · Drag to look · K or whistle for magic';
  prompt.classList.remove('hidden');
  controls.minDistance = 0.02;
  controls.maxDistance = 0.02;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.1;
  const seatOffset = new THREE.Vector3(0, 0.7, 0.8);
  const seatWorld = seatOffset.clone().applyMatrix4(boatMovingGroup.matrixWorld);
  camera.position.copy(seatWorld);
  controls.target.set(seatWorld.x, seatWorld.y, seatWorld.z - 1);
  // Show treasure spotlight and beam 5 seconds after boarding
  setTimeout(() => {
    if (treasureSpotLight) treasureSpotLight.intensity = 4;
    if (treasureLightStreamMesh) treasureLightStreamMesh.visible = true;
  }, 5000);
}

// ---------- Animation loop ----------
const clock = new THREE.Clock();
let timeAcc = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  const t = clock.getElapsedTime();
  timeAcc += dt;
  _animateFrame++;

  if (!state.inBoat) {
    const speed = state.walkSpeed * dt;
    camera.getWorldDirection(_dir);
    _dir.y = 0;
    _dir.normalize();
    _right.crossVectors(camera.up, _dir).normalize();
    if (keys.w) { camera.position.addScaledVector(_dir, speed); controls.target.addScaledVector(_dir, speed); }
    if (keys.s) { camera.position.addScaledVector(_dir, -speed); controls.target.addScaledVector(_dir, -speed); }
    if (keys.a) { camera.position.addScaledVector(_right, speed); controls.target.addScaledVector(_right, speed); }
    if (keys.d) { camera.position.addScaledVector(_right, -speed); controls.target.addScaledVector(_right, -speed); }
    camera.position.y = Math.max(2.0, Math.min(4.0, camera.position.y));
    if (camera.position.distanceTo(_distToBoat) < 5.0) {
      prompt.textContent = 'Press G to Enter Boat';
      prompt.classList.remove('hidden');
    } else if (!state.magicRevealed) prompt.classList.add('hidden');
  }

  if (state.inBoat && !state.whistleDetected && checkWhistle()) revealMagic();

  if (state.inBoat && boatMovingGroup) {
    const maxSpeed = 1.8;
    const accel = 1.0 * dt;
    const turnSpeed = 0.9 * dt;
    if (keys.w) boatSpeed += accel;
    if (keys.s) boatSpeed -= accel;
    if (keys.a) boatYawVelocity += turnSpeed;
    if (keys.d) boatYawVelocity -= turnSpeed;
    boatSpeed = Math.max(-maxSpeed * 0.5, Math.min(maxSpeed, boatSpeed));
    boatSpeed *= 0.96;
    boatYawVelocity *= 0.88;
    boatMovingGroup.rotation.y += boatYawVelocity;
    // Forward = direction of boat's head (local -Z) in world space; keep movement on XZ plane
    _forwardNow.set(0, 0, -1).applyQuaternion(boatMovingGroup.quaternion);
    _forwardNow.y = 0;
    if (_forwardNow.lengthSq() > 1e-6) _forwardNow.normalize();
    else _forwardNow.set(0, 0, -1);
    boatVelocity.copy(_forwardNow).multiplyScalar(boatSpeed);
    boatMovingGroup.position.addScaledVector(boatVelocity, 1);

    _seatWorld.copy(_seatOffset).applyMatrix4(boatMovingGroup.matrixWorld);
    _lookDir.subVectors(controls.target, camera.position);
    const len = _lookDir.length();
    if (len < 0.001) _lookDir.set(0, 0, -1).applyQuaternion(boatMovingGroup.quaternion);
    else { _lookDir.normalize(); _lookDir.applyAxisAngle(_yAxis, boatYawVelocity); }
    camera.position.copy(_seatWorld);
    controls.target.copy(_seatWorld).addScaledVector(_lookDir, 0.02);

    if (state.boatLanternHeld && boatFlyableLantern) {
      camera.getWorldDirection(_dir);
      boatFlyableLantern.position.copy(camera.position).addScaledVector(_dir, 0.65);
      boatFlyableLantern.position.y -= 0.12;
    }

    // Treasure: show prompt when near chest (in boat)
    if (!state.treasureChestPickedUp && boatMovingGroup) {
      const bx = boatMovingGroup.position.x, bz = boatMovingGroup.position.z;
      const distToTreasure = Math.sqrt((TREASURE_X - bx) ** 2 + (TREASURE_Z - bz) ** 2);
      if (distToTreasure < TREASURE_PICKUP_RANGE) {
        prompt.textContent = 'Press E to pick up treasure chest';
        prompt.classList.remove('hidden');
      }
    } else if (state.treasureChestPickedUp && !state.treasureChestOpened) {
      prompt.textContent = 'Press E to open the chest';
      prompt.classList.remove('hidden');
    } else if (state.treasureChestPickedUp && state.treasureChestOpened && !state.hasSilverWhistle) {
      prompt.textContent = 'Press E to take the silver whistle';
      prompt.classList.remove('hidden');
    } else if (state.magicRevealed && boatFlyableLantern && boatFlyableLantern.parent === boatMovingGroup) {
      // prompt.textContent = 'Press E to pick up the lantern';
      // prompt.classList.remove('hidden');
    } else if (state.boatLanternHeld) {
      prompt.textContent = 'Press E to light and release the lantern';
      prompt.classList.remove('hidden');
    }
  }

  // Chest lid OPEN animation (hinge at front, lid swings back and up so you see inside)
  if (state.treasureChestOpened && boatChestLid) {
    chestLidOpenT = Math.min(1, chestLidOpenT + dt * 2.5);
    boatChestLid.rotation.x = -Math.PI / 2 * chestLidOpenT;
    if (boatChestWhistle) boatChestWhistle.visible = true;
  }

  // Gold dust: update and fade out, then remove
  if (goldDustPoints && goldDustPoints.userData.startTime !== undefined) {
    const elapsed = (performance.now() - goldDustPoints.userData.startTime) / 1000;
    const pos = goldDustPoints.geometry.attributes.position.array;
    const vel = goldDustPoints.userData.velocities;
    for (let i = 0; i < vel.length; i++) {
      pos[i * 3] += vel[i].x * dt;
      pos[i * 3 + 1] += vel[i].y * dt;
      pos[i * 3 + 2] += vel[i].z * dt;
      vel[i].y -= 2.5 * dt; // gentle fall
    }
    goldDustPoints.geometry.attributes.position.needsUpdate = true;
    const fade = Math.max(0, 1 - elapsed / 2.2);
    goldDustPoints.material.opacity = fade * 0.9;
    if (elapsed > 2.5) {
      scene.remove(goldDustPoints);
      goldDustPoints.geometry.dispose();
      goldDustPoints.material.dispose();
      goldDustPoints = null;
    }
  }

  // Sea: wave animation + white foam crests
  if (seaMesh) updateSeaWaves(t);
  if (seaGlowMesh) seaGlowMesh.material.opacity = 0.08 + 0.06 * Math.sin(t * 0.5);

  // Splashes: particle system update
  if (seaSplashes && seaSplashes.userData.velocities) {
    const positions = seaSplashes.geometry.attributes.position.array;
    const { velocities, timers } = seaSplashes.userData;
    
    for(let i=0; i < velocities.length; i++) {
      timers[i] -= dt;
      
      // If inactive and timer done, respawn
      if (positions[i*3+1] < -2 && timers[i] <= 0) {
        positions[i*3] = (Math.random() - 0.5) * 40;
        positions[i*3+1] = -0.2; // Surface
        positions[i*3+2] = (Math.random() - 0.5) * 40;
        
        // Random upward burst
        velocities[i].x = (Math.random() - 0.5) * 0.5;
        velocities[i].y = 1.5 + Math.random() * 1.5;
        velocities[i].z = (Math.random() - 0.5) * 0.5;
        
        timers[i] = 1.0 + Math.random(); // Life duration
      } 
      
      // If active (above water roughly)
      if (positions[i*3+1] > -5) {
        velocities[i].y -= 9.8 * dt; // Gravity
        
        positions[i*3]   += velocities[i].x * dt;
        positions[i*3+1] += velocities[i].y * dt;
        positions[i*3+2] += velocities[i].z * dt;
        
        // Kill if falls below water
        if (positions[i*3+1] < -0.5) {
           positions[i*3+1] = -10; // Hide
           timers[i] = Math.random() * 2; // Wait before respawn
        }
      }
    }
    seaSplashes.geometry.attributes.position.needsUpdate = true;
  }

  // Lanterns: rise, wobble, respawn when high — always at current boat position (not map center)
  if (lanternsRiseStartTime != null && (lanternsGroup?.visible || balloonsGroup?.visible || decorationsGroup?.visible)) {
    const elapsed = (performance.now() - lanternsRiseStartTime) / 1000;
    const easeIn = Math.min(1, elapsed / 2);
    const rise = dt * easeIn;
    const boat = boatMovingGroup?.position;
    const boatPos = boat;

    if (lanternsGroup?.visible && boatPos) {
      const bx = boatPos.x, by = boatPos.y, bz = boatPos.z;
      const respawnSpread = LANTERN_RESPAWN_RADIUS * 2;
      let respawnCx = bx, respawnCy = by - 8, respawnCz = bz;
      lanternsGroup.children.forEach((lamp, i) => {
        lamp.position.y += (lamp.userData.riseSpeed || 0.4) * rise;
        const wobble = (lamp.userData.wobble || 0.01) * Math.sin(t * 0.8 + i * 0.5);
        lamp.position.x += wobble * rise * 8;
        lamp.position.z += (lamp.userData.wobble || 0.01) * Math.cos(t * 0.7 + i * 0.3) * rise * 8;
        if (lamp.position.y > 58) {
          if (i % LANTERN_CLUSTER_SIZE === 0) {
            respawnCx = bx + (Math.random() - 0.5) * respawnSpread;
            respawnCy = by - 8 - Math.random() * 22;
            respawnCz = bz + (Math.random() - 0.5) * respawnSpread;
          }
          lamp.position.set(
            respawnCx + (Math.random() - 0.5) * LANTERN_CLUSTER_SPREAD * 2,
            respawnCy + (Math.random() - 0.5) * 8,
            respawnCz + (Math.random() - 0.5) * LANTERN_CLUSTER_SPREAD * 2
          );
        }
      });
    }
    if (balloonsGroup?.visible) {
      balloonsGroup.children.forEach((heart, i) => {
        heart.position.y += (heart.userData.riseSpeed || 0.5) * rise;
        const wobble = (heart.userData.wobble || 0.015) * Math.sin(t * 0.6 + i * 0.4);
        heart.position.x += wobble * rise * 6;
        heart.position.z += (heart.userData.wobble || 0.015) * Math.cos(t * 0.5 + i * 0.2) * rise * 6;
        heart.rotation.y += dt * 0.15;
        if (boat && heart.position.y > 56) {
          heart.position.set(
            boat.x + (Math.random() - 0.5) * 95 * 2,
            boat.y - 10 - Math.random() * 20,
            boat.z + (Math.random() - 0.5) * 95 * 2
          );
        }
      });
    }
    if (decorationsGroup?.visible) {
      decorationsGroup.children.forEach((dec, i) => {
        dec.position.y += (dec.userData.riseSpeed || 0.45) * rise;
        const wobble = (dec.userData.wobble || 0.01) * Math.sin(t * 0.7 + i * 0.5);
        dec.position.x += wobble * rise * 7;
        dec.position.z += (dec.userData.wobble || 0.01) * Math.cos(t * 0.6 + i * 0.35) * rise * 7;
        dec.rotation.y += dt * 0.2;
        dec.rotation.x += dt * 0.08;
        if (boat && dec.position.y > 56) {
          dec.position.set(
            boat.x + (Math.random() - 0.5) * 95 * 2,
            boat.y - 14 - Math.random() * 20,
            boat.z + (Math.random() - 0.5) * 95 * 2
          );
        }
      });
    }
  }

  // Fireworks: everywhere, all directions — relaunch new bursts every 0.7s
  if (fireworksGroup?.visible && fireworksGroup.children.length) {
    const now = performance.now();
    if (now - lastContinuousFireworkTime > 700) {
      lastContinuousFireworkTime = now;
      const fireworkColors = [0xffaa44, 0xff6b9d, 0x98d8aa, 0xffdd99, 0xc9a0dc, 0xffb347, 0xff69b4, 0x00e5ff, 0xffeb3b];
      const bx = (Math.random() - 0.5) * FIREWORK_SPREAD * 2;
      const by = 14 + Math.random() * 22;
      const bz = (Math.random() - 0.5) * FIREWORK_SPREAD * 2;
      const color = fireworkColors[Math.floor(Math.random() * fireworkColors.length)];
      let launched = 0;
      fireworksGroup.children.forEach((p) => {
        if (launched >= 55) return;
        if (p.userData.life > 0) return;
        p.position.set(bx, by, bz);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const speed = 2.8 + Math.random() * 1.8;
        p.userData.vx = Math.sin(phi) * Math.cos(theta) * speed;
        p.userData.vy = Math.cos(phi) * speed;
        p.userData.vz = Math.sin(phi) * Math.sin(theta) * speed;
        p.userData.life = 1;
        p.userData.launched = true;
        if (p.material) p.material.color.setHex(color);
        p.material.opacity = 0.95;
        launched++;
      });
    }
    fireworksGroup.children.forEach((p) => {
      if (!p.userData?.launched) return;
      p.visible = true;
      p.position.x += (p.userData.vx || 0) * dt;
      p.position.y += (p.userData.vy || 0) * dt;
      p.position.z += (p.userData.vz || 0) * dt;
      p.userData.life = (p.userData.life || 1) - dt * 0.38;
      if (p.material && p.material.opacity !== undefined) p.material.opacity = Math.max(0, p.userData.life);
      if (p.userData.life <= 0) p.visible = false;
    });
  }

  // Flyable lantern: rising when released; show long sweet message a few seconds after release
  if (state.boatLanternFlying && boatFlyableLantern) {
    const rise = (boatFlyableLantern.userData.riseSpeed || 0.45) * dt;
    boatFlyableLantern.position.y += rise;
    boatFlyableLantern.userData.wobbleT = (boatFlyableLantern.userData.wobbleT || 0) + dt;
    const wobble = 0.015 * Math.sin(boatFlyableLantern.userData.wobbleT * 2) * rise * 8;
    boatFlyableLantern.position.x += wobble;
    boatFlyableLantern.position.z += 0.015 * Math.cos(boatFlyableLantern.userData.wobbleT * 1.7) * rise * 8;
    const releaseTime = boatFlyableLantern.userData.releaseTime;
    if (releaseTime && performance.now() - releaseTime > 3500) {
      state.sweetMessageShown = true;
      if (sweetMessageGroup) sweetMessageGroup.visible = true;
    }
  }
  if (sweetMessageGroup && sweetMessageGroup.visible) {
    sweetMessageGroup.lookAt(camera.position);
  }

  // Bioluminescent sparkles bob and pulse
  if (seaGlowGroup) {
    seaGlowGroup.children.forEach(p => {
      p.userData.phase += dt * p.userData.speed;
      p.position.y = p.userData.base.y + Math.sin(p.userData.phase) * 0.04;
      p.material.opacity = 0.3 + 0.35 * Math.sin(p.userData.phase * 2);
    });
  }

  if (boatMovingGroup) {
    if (boatMovingGroup.userData.baseY === undefined) boatMovingGroup.userData.baseY = 0;
    const waveY = 0.35 * Math.sin(t * 0.8) * Math.cos(t * 0.6) + 0.2 * Math.sin(t * 0.5) * Math.cos(t * 0.4);
    const newY = boatMovingGroup.userData.baseY + waveY * 0.4;
    const deltaY = newY - boatMovingGroup.position.y;
    boatMovingGroup.position.y = newY;
    if (state.inBoat) {
      camera.position.y += deltaY;
      controls.target.y += deltaY;
    }
    const innerBoat = boatMovingGroup.children[0];
    if (innerBoat) {
      innerBoat.rotation.z = Math.sin(t * 0.6) * 0.02;
      innerBoat.rotation.x = Math.sin(t * 0.5 + 0.5) * 0.012;
    }
  }

  // Boat candle flames flicker
  if (boatMovingGroup && boatMovingGroup.children[1]) {
    const candleGroup = boatMovingGroup.children[1];
    if (candleGroup.userData.flames) {
      candleGroup.userData.flames.forEach((flame, i) => {
        flame.position.y = flame.userData.baseY + Math.sin(t * 8 + i * 2) * 0.02;
        flame.material.opacity = 0.85 + Math.sin(t * 10 + i) * 0.1;
      });
    }
  }

  // Star message: face camera (billboard), cursive writing animation (no fade, no blink)
  if (starMessageGroup && starMessageGroup.visible) {
    starMessageGroup.lookAt(camera.position);
    if (starMessageGroup.userData.animating && starMessageGroup.userData.starCanvas) {
      let p = starMessageGroup.userData.writeProgress;
      p = Math.min(1, p + dt * 0.08);
      starMessageGroup.userData.writeProgress = p;
      drawStarMessage(p);
      if (p >= 1) starMessageGroup.userData.animating = false;
    }
  }

  // Magic flower bloom
  if (magicFlower && magicFlower.userData.bloom && magicFlower.userData.petal) {
    magicFlower.userData.petal.scale.lerp(_one, 0.03);
  }

  // Surreal elevated glow when magic is active (lanterns + fireworks)
  if (state.magicRevealed && bloomPass.strength < 0.32) {
    bloomPass.strength = Math.min(0.32, bloomPass.strength + dt * 0.08);
  }

  controls.update();
  composer.render();
}

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  bloomPass.resolution.set(window.innerWidth, window.innerHeight);
});

btnStart.addEventListener('click', onStart);
// Allow Enter key on start screen
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && startOverlay && !startOverlay.classList.contains('hidden')) {
    onStart();
  }
});
