import { tiny, defs } from '../common.js';

const {
  vec3, vec4, color, Mat4, Matrix, Shader, Texture, Component,
} = tiny;

const { Square, Subdivision_Sphere, Capped_Cylinder, Closed_Cone, Torus, Phong_Shader } = defs;

/* =========================
   Tunable Constants
========================= */
const GAME_CONFIG = {
  maxShots: 20,
  gravity: -15.0,
  baseArrowSpeed: 60,
  aimSensitivity: 0.04,
  maxDrawStrength: 1.0,
  drawChargeRate: 1.2,
  playerHeight: 2.0,
  arrowSpawnForward: 1.0,
  dtClamp: 1 / 30,
  aimAssistDistance: 70,       // makes off-center arrow pass through the crosshair region
};

const ARROW_SPEED_PRESETS = [
  60,
  60 * 3,
  60 * 5
];

const TARGET_SCORING = [
  { frac: 0.2, points: 10 },
  { frac: 0.4, points: 8 },
  { frac: 0.6, points: 6 },
  { frac: 0.8, points: 4 },
  { frac: 1.0, points: 2 },
];

const WEATHER_PRESETS = {
  clear: {
    spawnPerFrame: 0,
    windStrength: 0,
    windAngle: 0,
    particle: null,
  },
  wind: {
    spawnPerFrame: 2,
    windStrength: 6.0,
    windAngle: Math.PI * 0.7,
    particle: {
      life: [3, 5],
      speedX: [15, 20],
      speedY: [-2, -1],
      color: color(0.8, 0.8, 0.7, 0.3),
      scale: vec3(0.1, 0.1, 0.1),
    },
  },
  rain: {
    spawnPerFrame: 10,
    windStrength: 2.0,
    windAngle: Math.PI * 0.3,
    particle: {
      life: [1.0, 1.5],
      speedX: [-1, 1],
      speedY: [-40, -30],
      color: color(0.6, 0.7, 0.9, 0.6),
      scale: vec3(0.05, 0.6, 0.05),
    },
  },
  snow: {
    spawnPerFrame: 5,
    windStrength: 1.0,
    windAngle: Math.PI * 0.85,
    particle: {
      life: [5, 7],
      speedX: [-1, 1],
      speedY: [-6, -4],
      color: color(0.9, 0.9, 1.0, 0.8),
      scale: vec3(0.12, 0.12, 0.12),
    },
  },
};

const ARM_CONFIG = {
  upperArmLen: 0.56,
  foreArmLen: 0.53,

  upperArmRadius: 0.065,
  foreArmRadius: 0.070,
  wristRadius: 0.055,
  handRadius: 0.090,

  // pull shoulders farther off screen so we mostly see the forearms/hands
  leftShoulderOffset: vec3(-0.52, -0.45, 0.20),
  rightShoulderOffset: vec3( 0.58, -0.48, 0.28),

  // bow more centered and cleaner in view
  bowGripOffset: vec3(-0.18, -0.22, -0.08),
  bowForward: 1.55,

  idleNockDistance: 0.10,
  maxPullDistance: 0.78,

  bowHalfHeight: 0.95,
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

/* =========================
   Weather System
========================= */
class WeatherSystem {
  constructor() {
    this.particles = [];
    this.max_particles = 400;
    this.weather_types = ['clear', 'wind', 'rain', 'snow'];
    this.current_index = 0;
    this.square = new Square();
  }

  get type() {
    return this.weather_types[this.current_index];
  }

  get preset() {
    return WEATHER_PRESETS[this.type];
  }

  cycle_type() {
    this.current_index = (this.current_index + 1) % this.weather_types.length;
    if (this.type === 'clear') this.particles.length = 0;
  }

  spawn_particle() {
    const preset = this.preset;
    if (!preset.particle || this.particles.length >= this.max_particles) return;

    const p = preset.particle;
    const base_pos = vec3(
      randRange(-35, 35),
      randRange(14, 24),
      randRange(-100, -15)
    );

    const velocity = vec3(
      randRange(p.speedX[0], p.speedX[1]),
      randRange(p.speedY[0], p.speedY[1]),
      0
    );

    this.particles.push({
      pos: base_pos,
      vel: velocity,
      life: randRange(p.life[0], p.life[1]),
      age: 0,
      color: p.color,
      scale: p.scale,
    });
  }

  update(dt) {
    const count = this.preset.spawnPerFrame;
    for (let i = 0; i < count; i++) this.spawn_particle();

    const remaining = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age > p.life) continue;

      p.pos = p.pos.plus(p.vel.times(dt));
      if (p.pos[1] < -5) continue;

      remaining.push(p);
    }
    this.particles = remaining;
  }

  draw(caller, uniforms, material) {
    if (this.type === 'clear') return;

    for (const p of this.particles) {
      const transform = Mat4.translation(...p.pos).times(Mat4.scale(...p.scale));
      this.square.draw(caller, uniforms, transform, { ...material, color: p.color });
    }
  }
}

/* =========================
   Moving Target (Lissajous)
========================= */
class Target {
  constructor(center, radius, depth, amp_x, amp_y, freq_x, freq_y) {
    this.base_center = center;
    this.radius = radius;
    this.depth = depth;
    this.amp_x = amp_x;
    this.amp_y = amp_y;
    this.freq_x = freq_x;
    this.freq_y = freq_y;
    this.time = 0;
  }

  update(dt) {
    this.time += dt;
  }

  get_center() {
    return vec3(
      this.base_center[0] + this.amp_x * Math.sin(this.time * this.freq_x),
      this.base_center[1] + this.amp_y * Math.sin(this.time * this.freq_y),
      this.base_center[2]
    );
  }
}

/* =========================
   Arrow Projectile
========================= */
class Arrow {
  constructor(position, velocity) {
    this.pos = position;
    this.prev_pos = position;
    this.vel = velocity;
    this.alive = true;
    this.stuck = false;
  }

  update(dt, gravity, wind_accel) {
    if (!this.alive || this.stuck) return;

    this.prev_pos = this.pos;

    const accel = vec3(wind_accel[0], gravity + wind_accel[1], wind_accel[2]);
    this.vel = this.vel.plus(accel.times(dt));
    this.pos = this.pos.plus(this.vel.times(dt));

    if (this.pos[1] < -2) this.alive = false;
  }

  get_direction() {
    if (this.vel.norm() < 1e-5) return vec3(0, 0, -1);
    return this.vel.normalized();
  }
}

/* =========================
   Main Scene
========================= */
export class Bullseye_Range extends Component {
  init() {
    this.widget_options = { make_controls: true };

    this.shapes = {
      ground: new Square(),
      target_face: new Capped_Cylinder(30, 30),
      post: new Capped_Cylinder(6, 16),
      arrow_shaft: new Capped_Cylinder(6, 12),
      arrow_head: new Capped_Cylinder(6, 12),
      bow_arc: new Torus(20, 20),
      dot: new Subdivision_Sphere(2),
      sphere: new Subdivision_Sphere(4),
      cone: new Closed_Cone(10, 20),
    };

    const phong = new Phong_Shader(1);
    this.materials = {
      ground:       { shader: phong, color: color(0.22, 0.45, 0.20, 1), ambient: 0.38, diffusivity: 0.8 },
      target_white: { shader: phong, color: color(0.95, 0.95, 0.95, 1), ambient: 0.5, diffusivity: 0.8 },
      target_black: { shader: phong, color: color(0.08, 0.08, 0.08, 1), ambient: 0.45, diffusivity: 0.85 },
      target_blue:  { shader: phong, color: color(0.15, 0.48, 0.85, 1), ambient: 0.52, diffusivity: 0.82 },
      target_red:   { shader: phong, color: color(0.82, 0.18, 0.18, 1), ambient: 0.52, diffusivity: 0.82 },
      target_gold:  { shader: phong, color: color(0.95, 0.82, 0.08, 1), ambient: 0.62, diffusivity: 0.82 },
      wood:         { shader: phong, color: color(0.42, 0.26, 0.12, 1), ambient: 0.35, diffusivity: 0.85 },
      bow_dark:     { shader: phong, color: color(0.25, 0.16, 0.08, 1), ambient: 0.35, diffusivity: 0.9 },
      arrow:        { shader: phong, color: color(0.78, 0.80, 0.82, 1), ambient: 0.5, diffusivity: 0.8 },
      particles:    { shader: phong, color: color(1, 1, 1, 0.7), ambient: 1.0, diffusivity: 0.0 },
      dot:          { shader: phong, color: color(1, 0.1, 0.1, 0.7), ambient: 1.0, diffusivity: 0.0 },
      sky:          { shader: phong, color: color(0.53, 0.77, 0.96, 1), ambient: 1.0, diffusivity: 0.0 },
      leaves:       { shader: phong, color: color(0.10, 0.42, 0.16, 1), ambient: 0.42, diffusivity: 0.85 },
      hill:         { shader: phong, color: color(0.19, 0.34, 0.14, 1), ambient: 0.32, diffusivity: 0.92 },
      hill_far:     { shader: phong, color: color(0.23, 0.40, 0.20, 1), ambient: 0.36, diffusivity: 0.88 },
      mountain:       { shader: phong, color: color(0.43, 0.50, 0.58, 1), ambient: 0.28, diffusivity: 0.85 },
      mountain_dark:  { shader: phong, color: color(0.30, 0.35, 0.40, 1), ambient: 0.24, diffusivity: 0.88 },
      mountain_light: { shader: phong, color: color(0.55, 0.60, 0.66, 1), ambient: 0.30, diffusivity: 0.84 },
      mountain_clear: { shader: phong, color: color(0.46, 0.52, 0.60, 1), ambient: 0.30, diffusivity: 0.85 },
      mountain_rain:  { shader: phong, color: color(0.34, 0.38, 0.44, 1), ambient: 0.22, diffusivity: 0.88 },
      mountain_snowy: { shader: phong, color: color(0.40, 0.45, 0.52, 1), ambient: 0.26, diffusivity: 0.86 },
      
      snow_cap:       { shader: phong, color: color(1, 1, 1, .95), ambient: 0.95, diffusivity: 0.4 },
      sun:          {   shader: new defs.Textured_Phong(), color: color(0, 0, 0, 1), ambient: 1, diffusivity: 0.0, specularity: 0, texture: new Texture("assets/textures/sun.jpg") },
      cloud:        { shader: phong, color: color(1.00, 1.00, 1.00, 0.95), ambient: 0.85, diffusivity: 0.05 },
      cloud_dark:     { shader: phong, color: color(0.45, 0.48, 0.52, 0.95), ambient: 0.65, diffusivity: 0.18 },
      cloud_storm:    { shader: phong, color: color(0.28, 0.30, 0.34, 0.98), ambient: 0.45, diffusivity: 0.25 },
      
      bark:         { shader: phong, color: color(0.28, 0.18, 0.08, 1), ambient: 0.28, diffusivity: 0.92 },
      leaves_dark:  { shader: phong, color: color(0.06, 0.24, 0.10, 1), ambient: 0.28, diffusivity: 0.90 },
      leaves_mid:   { shader: phong, color: color(0.10, 0.34, 0.14, 1), ambient: 0.34, diffusivity: 0.88 },
      leaves_light: { shader: phong, color: color(0.16, 0.42, 0.18, 1), ambient: 0.38, diffusivity: 0.84 },

      sleeve:       { shader: phong, color: color(0.10, 0.15, 0.24, 1), ambient: 0.35, diffusivity: 0.9 },
      cuff:         { shader: phong, color: color(0.18, 0.22, 0.32, 1), ambient: 0.35, diffusivity: 0.9 },
      glove:        { shader: phong, color: color(0.12, 0.10, 0.08, 1), ambient: 0.38, diffusivity: 0.88 },
      string:       { shader: phong, color: color(0.94, 0.94, 0.96, 1), ambient: 0.9, diffusivity: 0.1 },
    };

    this.reset_game();

    this.scoreboard_el = document.createElement('div');
    Object.assign(this.scoreboard_el.style, {
      position: 'absolute',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'rgba(5, 15, 5, 0.85)',
      border: '3px solid #0f0',
      color: '#0f0',
      fontFamily: '"Courier New", Courier, monospace',
      padding: '15px 30px',
      fontSize: '24px',
      fontWeight: 'bold',
      borderRadius: '10px',
      boxShadow: '0 0 15px rgba(0, 255, 0, 0.5)',
      textShadow: '0 0 8px #0f0',
      pointerEvents: 'none',
      zIndex: '1000',
      textAlign: 'center',
      whiteSpace: 'pre'
    });
    document.body.appendChild(this.scoreboard_el);

    // crosshair so aiming actually feels readable
    this.crosshair_el = document.createElement('div');
    Object.assign(this.crosshair_el.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '22px',
      height: '22px',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: '1000',
      opacity: '0.95'
    });
    this.crosshair_el.innerHTML = `
      <div style="
        position:absolute; left:50%; top:0; width:2px; height:8px;
        transform:translateX(-50%); background:white; box-shadow:0 0 6px rgba(255,255,255,0.9);"></div>
      <div style="
        position:absolute; left:50%; bottom:0; width:2px; height:8px;
        transform:translateX(-50%); background:white; box-shadow:0 0 6px rgba(255,255,255,0.9);"></div>
      <div style="
        position:absolute; top:50%; left:0; width:8px; height:2px;
        transform:translateY(-50%); background:white; box-shadow:0 0 6px rgba(255,255,255,0.9);"></div>
      <div style="
        position:absolute; top:50%; right:0; width:8px; height:2px;
        transform:translateY(-50%); background:white; box-shadow:0 0 6px rgba(255,255,255,0.9);"></div>
      <div style="
        position:absolute; left:50%; top:50%; width:4px; height:4px; border-radius:50%;
        transform:translate(-50%,-50%); background:rgba(255,255,255,0.95);
        box-shadow:0 0 7px rgba(255,255,255,1);"></div>
    `;
    document.body.appendChild(this.crosshair_el);

    const style = document.createElement('style');
    style.innerHTML = `
      @keyframes bullseye-flash {
        0% { transform: translateX(-50%) scale(1); background-color: rgba(5, 15, 5, 0.85); box-shadow: 0 0 15px rgba(0, 255, 0, 0.5); }
        50% { transform: translateX(-50%) scale(1.15); background-color: rgba(60, 50, 0, 0.95); box-shadow: 0 0 50px rgba(255, 255, 0, 1); border-color: #ff0; text-shadow: 0 0 15px #ff0; }
        100% { transform: translateX(-50%) scale(1); background-color: rgba(5, 15, 5, 0.85); box-shadow: 0 0 15px rgba(0, 255, 0, 0.5); }
      }
      .flash-active {
        animation: bullseye-flash 0.5s ease-out;
      }
    `;
    document.head.appendChild(style);
  }

  reset_game() {
    this.arrow_speed_index = 0;
    this.score = 0;
    this.shots_taken = 0;
    this.max_shots = GAME_CONFIG.maxShots;
    this.streak = 0;
    this.reload_timer=0;

    this.aim_yaw = 0;
    this.aim_pitch = 0;
    this.aim_sensitivity = GAME_CONFIG.aimSensitivity;

    this.is_drawing = false;
    this.draw_strength = 0;
    this.max_draw_strength = GAME_CONFIG.maxDrawStrength;

    this.arrows = [];
    this.gravity = GAME_CONFIG.gravity;

    this.weather = new WeatherSystem();
    this.target_centers = [];

    this.targets = [
      new Target(vec3(-5, 4, -40), 2.5, 0.2, 4, 1.5, 1.2, 2.4),
      new Target(vec3( 6, 6, -60), 3.0, 0.2, 8, 3.0, 0.8, 0.4),
    ];
  }

  /* ---------- Helpers ---------- */

  is_rainy_weather() {
    return this.weather.type === 'rain';
  }

  is_snowy_weather() {
    return this.weather.type === 'snow';
  }

  is_stormy_weather() {
    return this.weather.type === 'rain' || this.weather.type === 'snow';
  }

  show_mountain_snow() {
    return this.weather.type === 'rain' || this.weather.type === 'snow';
  }

  clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  get_weather_wind_vector() {
    const preset = this.weather.preset;
    const s = preset.windStrength;
    const a = preset.windAngle;
    return vec3(s * Math.cos(a), 0, s * Math.sin(a));
  }

  current_aim_direction() {
    const cy = Math.cos(this.aim_yaw), sy = Math.sin(this.aim_yaw);
    const cp = Math.cos(this.aim_pitch), sp = Math.sin(this.aim_pitch);
    return vec3(-sy * cp, sp, -cy * cp).normalized();
  }

  get_player_origin() {
    return vec3(0, GAME_CONFIG.playerHeight, 0);
  }

  compute_arrow_speed() {
    const base = ARROW_SPEED_PRESETS[this.arrow_speed_index];
    return base * (0.2 + 0.8 * this.draw_strength);
  }

  cycle_arrow_speed() {
    this.arrow_speed_index =
      (this.arrow_speed_index + 1) % ARROW_SPEED_PRESETS.length;
  }

  score_for_radius_fraction(frac) {
    for (const band of TARGET_SCORING) {
      if (frac <= band.frac) return band.points;
    }
    return 0;
  }

  trigger_scoreboard_flash() {
    if (!this.scoreboard_el) return;
    this.scoreboard_el.classList.remove('flash-active');
    void this.scoreboard_el.offsetWidth;
    this.scoreboard_el.classList.add('flash-active');
  }

  get_basis_from_dir(dir) {
    const forward = dir.normalized();
    let upHint = vec3(0, 1, 0);

    if (Math.abs(forward.dot(upHint)) > 0.995) {
      upHint = vec3(1, 0, 0);
    }

    let right = upHint.cross(forward);
    if (right.norm() < 1e-5) right = vec3(1, 0, 0);
    right = right.normalized();

    const up = forward.cross(right).normalized();

    return Matrix.of(
      [right[0],   right[1],   right[2],   0],
      [up[0],      up[1],      up[2],      0],
      [forward[0], forward[1], forward[2], 0],
      [0,          0,          0,          1]
    );
  }

  get_view_axes(dir) {
    const forward = dir.normalized();
    let upHint = vec3(0, 1, 0);

    if (Math.abs(forward.dot(upHint)) > 0.995) {
      upHint = vec3(1, 0, 0);
    }

    let right = forward.cross(upHint);
    if (right.norm() < 1e-5) right = vec3(1, 0, 0);
    right = right.normalized();

    const up = right.cross(forward).normalized();

    return { forward, right, up };
  }

  offset_in_view_space(base, axes, offset) {
    return base
      .plus(axes.right.times(offset[0]))
      .plus(axes.up.times(offset[1]))
      .plus(axes.forward.times(offset[2]));
  }

  solve_two_bone_ik(shoulder, target, len1, len2, bend_hint) {
    let toTarget = target.minus(shoulder);
    let dist = toTarget.norm();

    if (dist < 1e-6) {
      toTarget = vec3(0, 0, -1);
      dist = 1e-6;
    }

    const minReach = Math.abs(len1 - len2) + 1e-4;
    const maxReach = len1 + len2 - 1e-4;
    const clampedDist = this.clamp(dist, minReach, maxReach);

    const dir = toTarget.normalized();

    let bendDir = bend_hint.minus(dir.times(bend_hint.dot(dir)));
    if (bendDir.norm() < 1e-5) {
      bendDir = Math.abs(dir[1]) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
      bendDir = bendDir.minus(dir.times(bendDir.dot(dir)));
    }
    bendDir = bendDir.normalized();

    const cosShoulder = this.clamp(
      (len1 * len1 + clampedDist * clampedDist - len2 * len2) / (2 * len1 * clampedDist),
      -1, 1
    );
    const sinShoulder = Math.sqrt(Math.max(0, 1 - cosShoulder * cosShoulder));

    const elbow = shoulder
      .plus(dir.times(len1 * cosShoulder))
      .plus(bendDir.times(len1 * sinShoulder));

    const hand = shoulder.plus(dir.times(clampedDist));

    return { elbow, hand };
  }

  draw_segment(caller, a, b, radius, material) {
    const diff = b.minus(a);
    const len = diff.norm();
    if (len < 1e-5) return;

    const dir = diff.normalized();
    const basis = this.get_basis_from_dir(dir);

    const transform = Mat4.translation(...a)
      .times(basis)
      .times(Mat4.translation(0, 0, len / 2))
      .times(Mat4.scale(radius, radius, len / 2));

    this.shapes.post.draw(caller, this.uniforms, transform, material);
  }

  draw_joint(caller, pos, radius, material) {
    const transform = Mat4.translation(...pos).times(Mat4.scale(radius, radius, radius));
    this.shapes.sphere.draw(caller, this.uniforms, transform, material);
  }

  draw_hand(caller, handPos, forwardDir, sideDir, upDir, materialPalm, materialThumb) {
    const palm = Mat4.translation(...handPos)
      .times(this.get_basis_from_dir(forwardDir))
      .times(Mat4.translation(0, 0, 0.07))
      .times(Mat4.scale(0.07, 0.045, 0.10));
    this.shapes.sphere.draw(caller, this.uniforms, palm, materialPalm);

    const thumbBase = handPos
      .plus(sideDir.times(0.04))
      .plus(upDir.times(-0.015))
      .plus(forwardDir.times(0.03));

    const thumb = Mat4.translation(...thumbBase)
      .times(this.get_basis_from_dir(sideDir.plus(forwardDir.times(0.35)).normalized()))
      .times(Mat4.translation(0, 0, 0.035))
      .times(Mat4.scale(0.022, 0.022, 0.06));
    this.shapes.post.draw(caller, this.uniforms, thumb, materialThumb);
  }

  draw_tree(caller, base_pos, trunk_height, canopy_scale = 1.0) {
    const [x, y, z] = base_pos;

    // trunk
    const trunk = Mat4.translation(x, y + trunk_height / 2, z)
      .times(Mat4.scale(0.28 * canopy_scale, trunk_height / 2, 0.28 * canopy_scale));
    this.shapes.post.draw(caller, this.uniforms, trunk, this.materials.bark);

    // lower foliage layer
    const foliage1 = Mat4.translation(x, y + trunk_height * 0.95, z)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(1.7 * canopy_scale, 1.7 * canopy_scale, 3.0 * canopy_scale));
    this.shapes.cone.draw(caller, this.uniforms, foliage1, this.materials.leaves_dark);

    // middle foliage layer
    const foliage2 = Mat4.translation(x, y + trunk_height * 1.35, z + 0.15)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(1.35 * canopy_scale, 1.35 * canopy_scale, 2.35 * canopy_scale));
    this.shapes.cone.draw(caller, this.uniforms, foliage2, this.materials.leaves_mid);

    // upper foliage layer
    const foliage3 = Mat4.translation(x, y + trunk_height * 1.68, z - 0.08)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(0.95 * canopy_scale, 0.95 * canopy_scale, 1.65 * canopy_scale));
    this.shapes.cone.draw(caller, this.uniforms, foliage3, this.materials.leaves_light);

    // top point
    const foliage4 = Mat4.translation(x, y + trunk_height * 1.95, z)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(0.50 * canopy_scale, 0.50 * canopy_scale, 0.95 * canopy_scale));
    this.shapes.cone.draw(caller, this.uniforms, foliage4, this.materials.leaves_mid);

    // irregular side clumps so trees do not look too perfect
    const clump1 = Mat4.translation(x - 0.45 * canopy_scale, y + trunk_height * 1.18, z + 0.25)
      .times(Mat4.scale(0.42 * canopy_scale, 0.42 * canopy_scale, 0.42 * canopy_scale));
    this.shapes.sphere.draw(caller, this.uniforms, clump1, this.materials.leaves_dark);

    const clump2 = Mat4.translation(x + 0.38 * canopy_scale, y + trunk_height * 1.42, z - 0.18)
      .times(Mat4.scale(0.34 * canopy_scale, 0.34 * canopy_scale, 0.34 * canopy_scale));
    this.shapes.sphere.draw(caller, this.uniforms, clump2, this.materials.leaves_light);

    const clump3 = Mat4.translation(x - 0.22 * canopy_scale, y + trunk_height * 1.62, z - 0.28)
      .times(Mat4.scale(0.28 * canopy_scale, 0.28 * canopy_scale, 0.28 * canopy_scale));
    this.shapes.sphere.draw(caller, this.uniforms, clump3, this.materials.leaves_mid);
  }

  draw_cloud(caller, center, sx, sy, sz, material = this.materials.cloud) {
    const blobs = [
      vec3(-0.9, 0.0, 0.0),
      vec3(-0.3, 0.25, 0.1),
      vec3( 0.3, 0.18, 0.0),
      vec3( 0.95, 0.0, -0.1),
      vec3( 0.1, -0.08, 0.15),
    ];
    for (const b of blobs) {
      const t = Mat4.translation(
        center[0] + b[0] * sx,
        center[1] + b[1] * sy,
        center[2] + b[2] * sz
      ).times(Mat4.scale(0.85 * sx, 0.55 * sy, 0.55 * sz));
      this.shapes.sphere.draw(caller, this.uniforms, t, material);
    }
  }

  // drawing mountain
  draw_mountain(caller, base_pos, width, height, depth = 1.0) {
    let main_mat = this.materials.mountain_clear;
    let dark_mat = this.materials.mountain_dark;
    let light_mat = this.materials.mountain_light;

    if (this.weather.type === 'rain') {
      main_mat = this.materials.mountain_rain;
      dark_mat = this.materials.mountain_rain;
      light_mat = this.materials.mountain;
    } else if (this.weather.type === 'snow') {
      main_mat = this.materials.mountain_snowy;
      dark_mat = this.materials.mountain;
      light_mat = this.materials.mountain_light;
    }

    const [x, y, z] = base_pos;

    // Main central peak
    const main_peak = Mat4.translation(x, y, z)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 8, depth * width * 0.9, height * 1.6));
    this.shapes.cone.draw(caller, this.uniforms, main_peak, main_mat);

    // Left secondary peak
    const left_peak = Mat4.translation(x - width * 0.85, y - 0.3, z + 1.5)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 5, depth * width * 0.62, height * .1));
    this.shapes.cone.draw(caller, this.uniforms, left_peak, dark_mat);

    // Right secondary peak
    const right_peak = Mat4.translation(x + width * 0.95, y - 0.2, z - 1.2)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 0.66, depth * width * 0.58, height * 0.72));
    this.shapes.cone.draw(caller, this.uniforms, right_peak, light_mat);

    // Sharp front spike
    const front_spike = Mat4.translation(x + width * 0.18, y + height * 0.08, z + 2.8)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 3, depth * width * 6, height * .8));
    this.shapes.cone.draw(caller, this.uniforms, front_spike, dark_mat);

    // Small jagged spike
    const jagged_spike = Mat4.translation(x - width * 0.22, y + height * 0.12, z - 2.4)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 0.22, depth * width * 0.18, height * 0.42));
    this.shapes.cone.draw(caller, this.uniforms, jagged_spike, light_mat);

    // Snow cap on tallest peak
    const snow = Mat4.translation(x, y + height * 1.1, z + 0.6)
      .times(Mat4.rotation(-Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(width * 3, depth * width * .2, height * .5));

    if (this.show_mountain_snow()) {
      this.shapes.cone.draw(caller, this.uniforms, snow, this.materials.snow_cap);
    }
}

  draw_scenery(caller) {
    let sky_material = this.materials.sky;

    if (this.weather.type === 'rain') {
      sky_material = {
        ...this.materials.sky,
        color: color(0.20, 0.20, 0.20, 1),
        ambient: 0.65
      };
    } else if (this.weather.type === 'snow') {
      sky_material = {
        ...this.materials.sky,
        color: color(0.2, 0.2, 0.2, 1),
        ambient: 0.65
      };
    }

    // sky dome
    const sky_transform = Mat4.scale(170, 170, 170);
    this.shapes.sphere.draw(caller, this.uniforms, sky_transform, sky_material);

    // sun
    if (this.weather.type !== 'rain' && this.weather.type !== 'snow') {
      const sun_transform = Mat4.translation(38, 42, -120)
        .times(Mat4.rotation(-Math.PI / 2, 0, 1, 0))
        .times(Mat4.rotation(Math.PI, 0, 0, 1))
        .times(Mat4.scale(7, 7, 7));

      this.shapes.sphere.draw(caller, this.uniforms, sun_transform, this.materials.sun);
    }

    let cloud_material = this.materials.cloud;
    if (this.weather.type === 'rain') {
      cloud_material = this.materials.cloud_storm;
    } else if (this.weather.type === 'snow') {
      cloud_material = this.materials.cloud_dark;
    }

    // clouds
    this.draw_cloud(caller, vec3(-28, 26, -95), 4.5, 3.0, 2.2, cloud_material);
    this.draw_cloud(caller, vec3(18, 22, -85), 3.6, 2.5, 2.0, cloud_material);
    this.draw_cloud(caller, vec3(45, 28, -110), 4.0, 2.8, 2.4, cloud_material);

    // ground
    const ground_transform = Mat4.translation(0, 0, -55)
      .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(180, 180, 1));
    this.shapes.ground.draw(caller, this.uniforms, ground_transform, this.materials.ground);

    // shooting lane strip
    const lane_transform = Mat4.translation(0, 0.01, -35)
      .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(5.5, 55, 1));
    this.shapes.ground.draw(caller, this.uniforms, lane_transform, { ...this.materials.ground, color: color(0.30, 0.50, 0.24, 1) });

    // far mountains
    this.draw_mountain(caller, vec3(-78, 2, -158), 16, 24, 1.0);
    this.draw_mountain(caller, vec3(-42, 1, -150), 13, 19, 0.95);
    this.draw_mountain(caller, vec3(-6,  3, -162), 18, 28, 1.05);
    this.draw_mountain(caller, vec3(32,  2, -154), 15, 22, 0.9);
    this.draw_mountain(caller, vec3(72,  1, -160), 17, 25, 1.0);

    // rolling hills
    const hill_positions_far = [
      vec3(-45, -6, -112), vec3(38, -8, -118), vec3(0, -10, -126)
    ];
    for (const pos of hill_positions_far) {
      const t = Mat4.translation(...pos).times(Mat4.scale(42, 20, 24));
      this.shapes.sphere.draw(caller, this.uniforms, t, this.materials.hill_far);
    }

    const hill_positions_near = [
      vec3(-32, -6, -75), vec3(28, -7, -82), vec3(0, -8, -92)
    ];
    for (const pos of hill_positions_near) {
      const t = Mat4.translation(...pos).times(Mat4.scale(28, 14, 18));
      this.shapes.sphere.draw(caller, this.uniforms, t, this.materials.hill);
    }

    // lane side fences
    for (const x of [-8, 8]) {
      for (let z = -16; z >= -82; z -= 10) {
        const post_t = Mat4.translation(x, 1.2, z).times(Mat4.scale(0.12, 1.2, 0.12));
        this.shapes.post.draw(caller, this.uniforms, post_t, this.materials.wood);
      }

      const rail1 = Mat4.translation(x, 1.8, -50).times(Mat4.scale(0.06, 0.06, 33));
      const rail2 = Mat4.translation(x, 0.95, -50).times(Mat4.scale(0.05, 0.05, 33));
      this.shapes.post.draw(caller, this.uniforms, rail1, this.materials.wood);
      this.shapes.post.draw(caller, this.uniforms, rail2, this.materials.wood);
    }

    // trees
    const tree_layout = [
      { x: -24, z: -22, h: 4.6, s: 1.00 },
      { x: -19, z: -34, h: 3.0, s: .6 },
      { x: -24, z: -48, h: 4.3, s: 0.95 },
      { x: -19, z: -62, h: 5.4, s: 1.12 },
      { x: -24, z: -76, h: 4.8, s: 1.02 },
      { x: 19, z: -30, h: 5.2, s: 1.10 },
      { x:  24, z: -34, h: 5.3, s: 1.10 },
      { x:  -24, z: -34, h: 6.3, s: 1.10 },
      { x:  19, z: -48, h: 4.4, s: 0.94 },
      { x:  20, z: -60, h: 8.1, s: 1.3 },
      { x:  -19, z: -76, h: 4.9, s: 1.00 },
      { x:  24, z: -90, h: 5.5, s: 1.14 },

      // new trees
      { x: -28, z: -28, h: 5.1, s: 1.06 },
      { x: -20, z: -56, h: 4.7, s: 0.97 },
      { x: -27, z: -44, h: 5.4, s: 1.12 },

      { x: 28, z: -28, h: 5.0, s: 1.04 },
      { x: 30, z: -56, h: 4.8, s: 0.98 },
      { x: 27, z: -84, h: 5.3, s: 1.10 },
    ];

    for (const t of tree_layout) {
      this.draw_tree(caller, vec3(t.x, 0, t.z), t.h, t.s);
    }
  }

  draw_arrow_mesh(caller, pos, dir) {
    const basis = this.get_basis_from_dir(dir);

    const shaft_radius = 0.008;
    const shaft_length = 2.8;

    const shaft_transform = Mat4.translation(...pos)
      .times(basis)
      .times(Mat4.translation(0, 0, shaft_length / 2))
      .times(Mat4.scale(shaft_radius, shaft_radius, shaft_length / 2));

    const head_length = 0.18;
    const head_radius = 0.018;
    const head_transform = Mat4.translation(...pos)
      .times(basis)
      .times(Mat4.translation(0, 0, shaft_length + head_length / 2))
      .times(Mat4.scale(head_radius, head_radius, head_length / 2));

    this.shapes.arrow_shaft.draw(caller, this.uniforms, shaft_transform, this.materials.wood);
    this.shapes.arrow_head.draw(caller, this.uniforms, head_transform, this.materials.arrow);

    const vane_colors = [this.materials.target_red, this.materials.target_white, this.materials.target_white];
    for (let i = 0; i < 3; i++) {
      const angle = i * (2 * Math.PI / 3);
      const vane_transform = Mat4.translation(...pos)
        .times(basis)
        .times(Mat4.rotation(angle, 0, 0, 1))
        .times(Mat4.translation(0, 0.03, 0.28))
        .times(Mat4.rotation(Math.PI * 0.08, 1, 0, 0))
        .times(Mat4.scale(0.003, 0.07, 0.22));

      this.shapes.ground.draw(caller, this.uniforms, vane_transform, vane_colors[i]);
    }

    const nock_transform = Mat4.translation(...pos)
      .times(basis)
      .times(Mat4.translation(0, 0, 0.06))
      .times(Mat4.scale(0.012, 0.012, 0.06));

    this.shapes.arrow_shaft.draw(caller, this.uniforms, nock_transform, this.materials.target_black);
  }

  get_bow_setup() {
    const dir = this.current_aim_direction();
    const origin = this.get_player_origin();
    const axes = this.get_view_axes(dir);

    const bowGrip = this.offset_in_view_space(
      origin.plus(dir.times(ARM_CONFIG.bowForward)),
      axes,
      ARM_CONFIG.bowGripOffset
    );

    const drawDist = ARM_CONFIG.idleNockDistance + this.draw_strength * ARM_CONFIG.maxPullDistance;
    const nockPos = bowGrip.minus(dir.times(drawDist));

    const leftShoulder = this.offset_in_view_space(origin, axes, ARM_CONFIG.leftShoulderOffset);
    const rightShoulder = this.offset_in_view_space(origin, axes, ARM_CONFIG.rightShoulderOffset);

    const bowTop = bowGrip.plus(axes.up.times(ARM_CONFIG.bowHalfHeight));
    const bowBottom = bowGrip.minus(axes.up.times(ARM_CONFIG.bowHalfHeight));

    return {
      dir,
      origin,
      axes,
      bowGrip,
      nockPos,
      leftShoulder,
      rightShoulder,
      bowTop,
      bowBottom
    };
  }

  draw_arm_ik(caller, shoulder, target, bend_hint, handForward, handSide, handUp, isRight) {
    const solved = this.solve_two_bone_ik(
      shoulder,
      target,
      ARM_CONFIG.upperArmLen,
      ARM_CONFIG.foreArmLen,
      bend_hint
    );

    // upper arm mostly hidden, but still there for continuity
    this.draw_segment(caller, shoulder, solved.elbow, ARM_CONFIG.upperArmRadius, this.materials.sleeve);

    // fuller forearm sleeve
    this.draw_segment(caller, solved.elbow, solved.hand, ARM_CONFIG.foreArmRadius, this.materials.sleeve);

    // cuff near wrist
    const wristMid = solved.elbow.plus(solved.hand.minus(solved.elbow).times(0.82));
    this.draw_segment(
      caller,
      wristMid,
      solved.hand,
      ARM_CONFIG.wristRadius,
      this.materials.cuff
    );

    this.draw_joint(caller, solved.elbow, 0.075, this.materials.sleeve);

    const handOffset = isRight ? handSide.times(-0.015) : handSide.times(0.015);
    const palmCenter = solved.hand.plus(handOffset);
    this.draw_hand(caller, palmCenter, handForward, handSide, handUp, this.materials.glove, this.materials.glove);

    return solved;
  }

  draw_bow_rig(caller) {
    const setup = this.get_bow_setup();
    const { dir, axes, bowGrip, nockPos, leftShoulder, rightShoulder, bowTop, bowBottom } = setup;

    // more natural elbow bend directions
    const leftBendHint =
      axes.right.times(-0.95).plus(axes.up.times(-0.55)).plus(dir.times(0.20));
    const rightBendHint =
      axes.right.times(0.95).plus(axes.up.times(-0.55)).plus(dir.times(0.10));

    // left hand grips the bow
    this.draw_arm_ik(
      caller,
      leftShoulder,
      bowGrip,
      leftBendHint,
      axes.up,
      axes.right.times(-1),
      dir.times(-1),
      false
    );

    // right hand pulls the string/nock
    this.draw_arm_ik(
      caller,
      rightShoulder,
      nockPos,
      rightBendHint,
      dir.times(-1),
      axes.right,
      axes.up,
      true
    );

    // nicer bow shape
    const bow_transform = Mat4.translation(...bowGrip)
      .times(this.get_basis_from_dir(dir))
      .times(Mat4.rotation(Math.PI / 2, 0, 1, 0))
      .times(Mat4.scale(0.07, 1.25, 0.05));
    this.shapes.bow_arc.draw(caller, this.uniforms, bow_transform, this.materials.bow_dark);

    // center grip
    const grip_transform = Mat4.translation(...bowGrip)
      .times(this.get_basis_from_dir(dir))
      .times(Mat4.scale(0.045, 0.20, 0.045));
    this.shapes.post.draw(caller, this.uniforms, grip_transform, this.materials.wood);

    // bow string
    this.draw_segment(caller, bowTop, nockPos, 0.0045, this.materials.string);
    this.draw_segment(caller, nockPos, bowBottom, 0.0045, this.materials.string);

    // nocked arrow while drawing / ready
    if (this.reload_timer <= 0 && this.shots_taken < this.max_shots) {

  const flipped_dir = vec3(-dir[0], dir[1], dir[2]);

  this.draw_arrow_mesh(caller, nockPos, flipped_dir);
}
  }

  get_shot_state() {
  const setup = this.get_bow_setup();
  const speed = this.compute_arrow_speed();
  const wind = this.get_weather_wind_vector();

  // Launch exactly along camera/look direction
  const shotDir = setup.dir.normalized();
  const velocity = shotDir.times(speed).plus(wind);

  return {
    start: setup.nockPos,
    velocity,
    aimDir: shotDir
  };
}

  /* ---------- Gameplay ---------- */

  spawn_arrow() {
    if (this.shots_taken >= this.max_shots) return;

    const shot = this.get_shot_state();
    this.arrows.push(new Arrow(shot.start, shot.velocity));
    this.shots_taken++;
    this.reload_timer = 0.35;
  }

  update_aim(is_hold, dt) {
    if (!is_hold) return;
    this.draw_strength = Math.min(
      this.max_draw_strength,
      this.draw_strength + GAME_CONFIG.drawChargeRate * dt
    );
  }

  update_targets(dt) {
    for (const t of this.targets) t.update(dt);
    this.target_centers = this.targets.map(t => t.get_center());
  }

  update_arrows(dt) {
    const wind_vec = this.get_weather_wind_vector();
    for (const a of this.arrows) a.update(dt, this.gravity, wind_vec);
    this.arrows = this.arrows.filter(a => a.alive);
  }

  resolve_arrow_target_collisions() {
    for (const a of this.arrows) {
      if (!a.alive || a.stuck) continue;

      for (let i = 0; i < this.targets.length; i++) {
        const center = this.target_centers[i];
        const target = this.targets[i];

        const z0 = a.prev_pos[2];
        const z1 = a.pos[2];
        const tz = center[2];

        const dz = z1 - z0;
        if (Math.abs(dz) < 1e-8) continue;

        const crossesPlane = (z0 - tz) * (z1 - tz) <= 0;
        if (!crossesPlane) continue;

        const tHit = (tz - z0) / dz;
        if (tHit < 0 || tHit > 1) continue;

        const segment = a.pos.minus(a.prev_pos);
        const hit_pos = a.prev_pos.plus(segment.times(tHit));

        const dx = hit_pos[0] - center[0];
        const dy = hit_pos[1] - center[1];
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r <= target.radius) {
          const ring_frac = r / target.radius;
          const points = this.score_for_radius_fraction(ring_frac);

          this.score += points;
          this.streak = points >= 8 ? this.streak + 1 : 0;

          if (points >= 6) this.trigger_scoreboard_flash();

          a.stuck = true;
          a.vel = vec3(0, 0, 0);
          a.pos = hit_pos.plus(vec3(0, 0, 0.2));
          break;
        }
      }
    }
  }

  update_simulation(dt) {
    this.weather.update(dt);
    this.update_targets(dt);
    this.update_arrows(dt);
    this.resolve_arrow_target_collisions();
  }

  /* ---------- Rendering ---------- */

draw_trajectory(caller) {
  if (!this.is_drawing) return;

  const shot = this.get_shot_state();
  let pos = shot.start;
  let vel = shot.velocity;

  const wind = this.get_weather_wind_vector();
  const step = 0.075;
  const maxPoints = 28;

  for (let i = 0; i < maxPoints; i++) {
    vel = vel.plus(vec3(
      wind[0] * step,
      this.gravity * step + wind[1] * step,
      wind[2] * step
    ));
    pos = pos.plus(vel.times(step));

    if (pos[1] < -2) break;

    const t = Mat4.translation(...pos).times(Mat4.scale(0.055, 0.055, 0.055));
    this.shapes.dot.draw(caller, this.uniforms, t, this.materials.dot);
  }
}

  draw_targets(caller) {
    const rings = [
      { frac: 1.0, material: this.materials.target_white },
      { frac: 0.8, material: this.materials.target_black },
      { frac: 0.6, material: this.materials.target_blue  },
      { frac: 0.4, material: this.materials.target_red   },
      { frac: 0.2, material: this.materials.target_gold  },
    ];

    for (let i = 0; i < this.targets.length; i++) {
      const center = this.target_centers[i];
      const target = this.targets[i];

      const post_transform = Mat4.translation(center[0], center[1] - target.radius - 2.2, center[2])
        .times(Mat4.scale(0.16, target.radius + 2.2, 0.16));
      this.shapes.post.draw(caller, this.uniforms, post_transform, this.materials.wood);

      let layer = 0;
      for (const ring of rings) {
        const z_offset = layer * 0.045;

        const face_transform = Mat4.translation(center[0], center[1], center[2] + z_offset)
          .times(Mat4.scale(target.radius * ring.frac, target.radius * ring.frac, target.depth));

        this.shapes.target_face.draw(caller, this.uniforms, face_transform, ring.material);
        layer++;
      }
    }
  }

 draw_arrows(caller) {
  for (const a of this.arrows) {

    let dir = a.stuck ? vec3(0, 0, -1) : a.get_direction();

    // flip horizontal orientation
    dir = vec3(-dir[0], dir[1], dir[2]);

    this.draw_arrow_mesh(caller, a.pos, dir);
  }
}

  /* ---------- UI Controls ---------- */

  render_controls() {
    // fixed: left now actually goes left, right now actually goes right
    this.key_triggered_button('Aim Left', ['ArrowLeft'], () => this.aim_yaw += this.aim_sensitivity);
    this.key_triggered_button('Aim Right', ['ArrowRight'], () => this.aim_yaw -= this.aim_sensitivity);
    this.new_line();

    this.key_triggered_button('Aim Up', ['ArrowUp'], () => {
      this.aim_pitch = Math.min(this.aim_pitch + this.aim_sensitivity, 0.45);
    });
    this.key_triggered_button('Aim Down', ['ArrowDown'], () => {
      this.aim_pitch = Math.max(this.aim_pitch - this.aim_sensitivity, -0.45);
    });
    this.new_line();

    this.key_triggered_button(
      'Draw / Release',
      [' '],
      () => {
        if (!this.is_drawing && this.shots_taken < this.max_shots) {
          this.is_drawing = true;
          this.draw_strength = 0;
        }
      },
      undefined,
      () => {
        if (this.is_drawing) {
          this.is_drawing = false;
          this.spawn_arrow();
          this.draw_strength = 0;
        }
      }
    );

    this.new_line();
    this.key_triggered_button('Cycle Weather', ['q'], () => this.weather.cycle_type(), 'blue');
    this.key_triggered_button('Reset Game', ['r'], () => this.reset_game(), 'orange');
    this.key_triggered_button('Cycle Arrow Speed', ['e'], () => this.cycle_arrow_speed(), 'green');
    this.new_line();

    this.live_string(box => {
      const speed = ARROW_SPEED_PRESETS[this.arrow_speed_index];
      box.textContent =
        `Score: ${this.score}   Shots: ${this.shots_taken}/${this.max_shots}   ` +
        `Streak: ${this.streak}   Weather: ${this.weather.type.toUpperCase()}   ` +
        `Speed: ${speed}`;
    });
  }

  /* ---------- Main Render Loop ---------- */

  render_animation(caller) {
    caller.controls = null;

    const camera_matrix = Mat4.rotation(-this.aim_pitch, 1, 0, 0)
      .times(Mat4.rotation(-this.aim_yaw, 0, 1, 0))
      .times(Mat4.translation(0, -GAME_CONFIG.playerHeight, 0));

    Shader.assign_camera(camera_matrix, this.uniforms);

    this.uniforms.projection_transform = Mat4.perspective(
      Math.PI / 4,
      caller.width / caller.height,
      1,
      220
    );

    this.uniforms.lights = [
      defs.Phong_Shader.light_source(vec4(25, 40, 10, 1), color(1, 1, 1, 1), 600),
      defs.Phong_Shader.light_source(vec4(-40, 30, -80, 1), color(0.7, 0.75, 0.9, 1), 220),
    ];

    let dt = this.uniforms.animation_delta_time / 1000;
    dt = Math.min(dt, GAME_CONFIG.dtClamp);

    if (this.uniforms.animate) {
      if (this.is_drawing) this.update_aim(true, dt);
      this.update_simulation(dt);
      if (this.reload_timer > 0) {
      this.reload_timer -= dt;
    }
    }


    this.draw_scenery(caller);
    this.draw_targets(caller);
    this.draw_arrows(caller);
    this.draw_bow_rig(caller);
    this.draw_trajectory(caller);
    this.weather.draw(caller, this.uniforms, this.materials.particles);

    if (this.scoreboard_el) {
      const paddedScore = this.score.toString().padStart(4, '0');
      const paddedStreak = this.streak.toString().padStart(2, '0');
      const weatherTxt = this.weather.type.toUpperCase().padEnd(5, ' ');

      this.scoreboard_el.innerHTML =
        `SCORE: <span style="color:#fff">${paddedScore}</span>  |  ` +
        `SHOTS: ${this.shots_taken}/${this.max_shots}  |  ` +
        `STREAK: <span style="color:orange">${paddedStreak}</span>  |  ` +
        `WEATHER: <span style="color:#0ff">${weatherTxt}</span>`;
    }
  }
}