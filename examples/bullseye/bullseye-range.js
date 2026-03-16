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
  aimSensitivity: 0.01,
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
  upperArmLen: 0.62,
  foreArmLen: 0.56,

  upperArmRadius: 0.11,
  foreArmRadius: 0.10,
  handRadius: 0.05,

  // push shoulders much farther off screen
  leftShoulderOffset: vec3(-1.05, -0.78, 1.5),
  rightShoulderOffset: vec3( 1.12, -0.82, 1.6),

  // keep bow centered in view
  bowGripOffset: vec3(.25, -.1, 0.0),
  bowForward: 1.55,

  idleNockDistance: 0.10,
  maxPullDistance: 0.82,

  bowHalfHeight: 0.95,
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

class ArmNode {
  constructor(name, shape, transform, material) {
    this.name = name;
    this.shape = shape;
    this.transform = transform;
    this.material = material;
    this.children = [];
  }
}

class ArmArc {
  constructor(name, parent_node, child_node, location_matrix) {
    this.name = name;
    this.parent_node = parent_node;
    this.child_node = child_node;
    this.location_matrix = location_matrix;
    this.articulation_matrix = Mat4.identity();
  }
}

class Bow_Arm_Rig {
  constructor(shapes, materials) {
    this.shapes = shapes;
    this.materials = materials;

    this.upper_len = 0.62;
    this.lower_len = 0.56;

    this.upper_radius = 0.11;
    this.lower_radius = 0.10;
    this.hand_radius  = 0.05;

    this.left_root  = Mat4.translation(.24, -0.72, 0.28);
    this.right_root = Mat4.translation( .24, 1.25, 0.34);

    this._build_left_arm();
    this._build_right_arm();
  }

  _segment_transform(length, radius, dir = 1) {
    let t = Mat4.scale(radius, radius, length * 0.5);
    t.pre_multiply(Mat4.translation(0, 0, dir * length * 0.5));
    return t;
  }

  _hand_transform(radius) {
    return Mat4.scale(radius, radius, radius);
  }

  _build_left_arm() {
    this.left_upper_node = new ArmNode(
      "left_upper",
      this.shapes.sphere,
      this._segment_transform(this.upper_len, this.upper_radius, 1),
      "sleeve"
    );

    this.left_lower_node = new ArmNode(
      "left_lower",
      this.shapes.sphere,
      this._segment_transform(this.lower_len, this.lower_radius, 1),
      "sleeve"
    );

    this.left_hand_node = new ArmNode(
      "left_hand",
      this.shapes.sphere,
      this._hand_transform(this.hand_radius),
      "glove"
    );

    this.left_root_arc = new ArmArc("left_root", null, this.left_upper_node, this.left_root);
    this.left_elbow_arc = new ArmArc(
      "left_elbow",
      this.left_upper_node,
      this.left_lower_node,
      Mat4.translation(0, 0, this.upper_len)
    );
    this.left_wrist_arc = new ArmArc(
      "left_wrist",
      this.left_lower_node,
      this.left_hand_node,
      Mat4.translation(0, 0, this.lower_len)
    );

    this.left_upper_node.children.push(this.left_elbow_arc);
    this.left_lower_node.children.push(this.left_wrist_arc);
  }

  _build_right_arm() {
    this.right_upper_node = new ArmNode(
      "right_upper",
      this.shapes.sphere,
      this._segment_transform(this.upper_len, this.upper_radius, 1),
      "sleeve"
    );

    this.right_lower_node = new ArmNode(
      "right_lower",
      this.shapes.sphere,
      this._segment_transform(this.lower_len, this.lower_radius, 1),
      "sleeve"
    );

    this.right_hand_node = new ArmNode(
      "right_hand",
      this.shapes.sphere,
      this._hand_transform(this.hand_radius),
      "glove"
    );

    this.right_root_arc = new ArmArc("right_root", null, this.right_upper_node, this.right_root);
    this.right_elbow_arc = new ArmArc(
      "right_elbow",
      this.right_upper_node,
      this.right_lower_node,
      Mat4.translation(0, 0, this.upper_len)
    );
    this.right_wrist_arc = new ArmArc(
      "right_wrist",
      this.right_lower_node,
      this.right_hand_node,
      Mat4.translation(0, 0, this.lower_len)
    );

    this.right_upper_node.children.push(this.right_elbow_arc);
    this.right_lower_node.children.push(this.right_wrist_arc);
  }

  _aim_basis(origin, target, bend_hint) {
    let forward = target.minus(origin).normalized();

    let right = forward.cross(bend_hint);
    if (right.norm() < 1e-5) right = vec3(1, 0, 0);
    right = right.normalized();

    let up = right.cross(forward);
    if (up.norm() < 1e-5) up = vec3(0, 1, 0);
    up = up.normalized();

    right = forward.cross(up).normalized();

    return { forward, up, right };
  }

  solve_two_bone(origin, target, bend_hint) {
    const to_target = target.minus(origin);
    const dist_raw = to_target.norm();
    const max_len = this.upper_len + this.lower_len - 1e-4;
    const dist = Math.min(Math.max(dist_raw, 1e-5), max_len);

    const { forward, up, right } = this._aim_basis(origin, target, bend_hint);

    const a = this.upper_len;
    const b = this.lower_len;

    const x = (a*a - b*b + dist*dist) / (2 * dist);
    const y_sq = Math.max(0, a*a - x*x);
    const y = Math.sqrt(y_sq);

    const elbow = origin.plus(forward.times(x)).plus(up.times(y));
    return { elbow, hand: target };
  }

  _matrix_from_points(a, b) {
    const dir = b.minus(a);
    const len = Math.max(dir.norm(), 1e-5);
    const z = dir.normalized();

    let ref = Math.abs(z[1]) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    let x = ref.cross(z);
    if (x.norm() < 1e-5) x = vec3(1, 0, 0);
    x = x.normalized();
    let y = z.cross(x).normalized();

    const basis = Matrix.of(
      [x[0], x[1], x[2], 0],
      [y[0], y[1], y[2], 0],
      [z[0], z[1], z[2], 0],
      [0,    0,    0,    1]
    );

    return Mat4.translation(...a).times(basis).times(Mat4.scale(1, 1, len));
  }

  draw_segment(caller, uniforms, a, b, radius, material) {
    const dir = b.minus(a);
    const len = Math.max(dir.norm(), 1e-5);
    const z = dir.normalized();

    let ref = Math.abs(z[1]) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
    let x = ref.cross(z);
    if (x.norm() < 1e-5) x = vec3(1, 0, 0);
    x = x.normalized();
    let y = z.cross(x).normalized();

    const basis = Matrix.of(
      [x[0], x[1], x[2], 0],
      [y[0], y[1], y[2], 0],
      [z[0], z[1], z[2], 0],
      [0,    0,    0,    1]
    );

    const transform = Mat4.translation(...a)
      .times(basis)
      .times(Mat4.translation(0, 0, len * 0.5))
      .times(Mat4.scale(radius, radius, len * 0.5));

    this.shapes.sphere.draw(caller, uniforms, transform, material);
  }

  draw_hand(caller, uniforms, pos, material) {
    const t = Mat4.translation(...pos).times(Mat4.scale(this.hand_radius, this.hand_radius, this.hand_radius));
    this.shapes.sphere.draw(caller, uniforms, t, material);
  }

  draw_arm(caller, uniforms, shoulder, target, bend_hint) {
    const solved = this.solve_two_bone(shoulder, target, bend_hint);

    const upper_start = shoulder.plus(solved.elbow.minus(shoulder).times(0.55));

    this.draw_segment(
      caller, uniforms,
      upper_start, solved.elbow,
      this.upper_radius,
      this.materials.sleeve
    );

    this.draw_segment(
      caller, uniforms,
      solved.elbow, solved.hand,
      this.lower_radius,
      this.materials.sleeve
    );

    this.draw_hand(caller, uniforms, solved.hand, this.materials.glove);

    return solved;
  }

  draw(caller, uniforms, bowGrip, nockPos, dir, axes) {
    const leftShoulder  = this.left_root.times(vec4(0, 0, 0, 1)).to3();
    const rightShoulder = this.right_root.times(vec4(0, 0, 0, 1)).to3();

    const leftBendHint =
      axes.right.times(-1.45).plus(axes.up.times(-0.95)).plus(dir.times(0.20));

    const rightBendHint =
      axes.right.times( 1.45).plus(axes.up.times(-0.95)).plus(dir.times(0.10));

    this.draw_arm(caller, uniforms, rightShoulder, nockPos, rightBendHint);
  }
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
    this.stuck_dir = null;
    this.stuck_target_index = null;
    this.stuck_offset = null;
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
    if (this.stuck && this.stuck_dir) return this.stuck_dir;   // add this
    if (this.vel.norm() < 1e-5) return vec3(0, 0, -1);
    return this.vel.normalized();
  }
}

/* =========================
   Main Scene
========================= */
export class Bullseye_Range extends Component {
  init() {
    console.log("init"); 
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
      ground:       { shader: phong, color: color(0.28, 0.52, 0.26, 1), ambient: 0.38, diffusivity: 0.8 },
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
      sun:          {   shader: new defs.Textured_Phong(), color: color(0, 0, 0, 1), ambient: 1, diffusivity: 0.0, specularity: 0, texture: new Texture("assets/sun.jpg") },
      cloud:        { shader: phong, color: color(1.00, 1.00, 1.00, 0.95), ambient: 0.85, diffusivity: 0.05 },
      cloud_dark:     { shader: phong, color: color(0.45, 0.48, 0.52, 0.95), ambient: 0.65, diffusivity: 0.18 },
      cloud_storm:    { shader: phong, color: color(0.28, 0.30, 0.34, 0.98), ambient: 0.45, diffusivity: 0.25 },
      
      bark:         { shader: phong, color: color(0.28, 0.18, 0.08, 1), ambient: 0.28, diffusivity: 0.92 },
      leaves_dark:  { shader: phong, color: color(0.06, 0.24, 0.10, 1), ambient: 0.28, diffusivity: 0.90 },
      leaves_mid:   { shader: phong, color: color(0.10, 0.34, 0.14, 1), ambient: 0.34, diffusivity: 0.88 },
      leaves_light: { shader: phong, color: color(0.16, 0.42, 0.18, 1), ambient: 0.38, diffusivity: 0.84 },

      sleeve:       { shader: phong, color: color(0.18, 0.24, 0.36, 1), ambient: 0.35, diffusivity: 0.9 },
      cuff:         { shader: phong, color: color(0.18, 0.22, 0.32, 1), ambient: 0.35, diffusivity: 0.9 },
      glove:        { shader: phong, color: color(0.12, 0.10, 0.08, 1), ambient: 0.38, diffusivity: 0.88 },
      string:       { shader: phong, color: color(0.94, 0.94, 0.96, 1), ambient: 0.9, diffusivity: 0.1 },

      // cow materials
      cow_white:    { shader: phong, color: color(0.92, 0.90, 0.88, 1), ambient: 0.40, diffusivity: 0.85 },
      cow_black:    { shader: phong, color: color(0.08, 0.07, 0.07, 1), ambient: 0.30, diffusivity: 0.80 },
      cow_pink:     { shader: phong, color: color(0.88, 0.60, 0.60, 1), ambient: 0.50, diffusivity: 0.75 },
      cow_hoof:     { shader: phong, color: color(0.18, 0.14, 0.10, 1), ambient: 0.28, diffusivity: 0.80 },
      cow_horn:     { shader: phong, color: color(0.78, 0.70, 0.48, 1), ambient: 0.38, diffusivity: 0.78 },
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
      @keyframes penalty-flash {
        0%   { transform: translateX(-50%) scale(1);    background-color: rgba(5,15,5,0.85);   box-shadow: 0 0 15px rgba(0,255,0,0.5); border-color: #0f0; }
        20%  { transform: translateX(-50%) scale(1.18); background-color: rgba(90,0,0,0.97);   box-shadow: 0 0 60px rgba(255,0,0,1);   border-color: #f00; color: #f00; text-shadow: 0 0 18px #f00; }
        60%  { transform: translateX(-50%) scale(1.12); background-color: rgba(70,0,0,0.95);   box-shadow: 0 0 40px rgba(255,0,0,0.8); border-color: #f00; }
        100% { transform: translateX(-50%) scale(1);    background-color: rgba(5,15,5,0.85);   box-shadow: 0 0 15px rgba(0,255,0,0.5); border-color: #0f0; color: #0f0; text-shadow: 0 0 8px #0f0; }
      }
      .penalty-flash-active {
        animation: penalty-flash 0.9s ease-out;
      }
    `;
    document.head.appendChild(style);

    this.arm_rig = new Bow_Arm_Rig(this.shapes, {
      sleeve: this.materials.sleeve,
      glove: this.materials.glove
    });

    this.held_keys = {};
    document.addEventListener('keydown', e => {
      // Prevent the browser from scrolling the page with arrow keys or space,
      if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
      this.held_keys[e.key] = true;
    });
    document.addEventListener('keyup', e => this.held_keys[e.key] = false);
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

    // Bounding spheres for each cow (center x, y, z, radius).
    // Each cow is roughly 1.6 units long so a radius of 1.8 is generous.
    this.cow_bounds = [
      { x: -10, y: 1.1, z: -28 },
      { x: -13, y: 1.1, z: -18 },
      { x: -11, y: 1.1, z: -50 },
      { x: -14, y: 1.1, z: -72 },
      { x:  10, y: 1.1, z: -22 },
      { x:  12, y: 1.1, z: -45 },
      { x:  13, y: 1.1, z: -68 },
      { x: -16, y: 1.1, z: -35 },
      { x:  15, y: 1.1, z: -33 },
    ].map(c => ({ ...c, r: 1.8 }));
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
    this.scoreboard_el.classList.remove('flash-active', 'penalty-flash-active');
    void this.scoreboard_el.offsetWidth;
    this.scoreboard_el.classList.add('flash-active');
  }

  trigger_penalty_flash() {
    if (!this.scoreboard_el) return;
    this.scoreboard_el.classList.remove('flash-active', 'penalty-flash-active');
    void this.scoreboard_el.offsetWidth;
    this.scoreboard_el.classList.add('penalty-flash-active');
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

  get_basis_from_forward_up(forward, upHint) {
    let f = forward.normalized();

    let u = upHint.minus(f.times(upHint.dot(f)));
    if (u.norm() < 1e-5) {
      u = Math.abs(f[1]) < 0.95 ? vec3(0, 1, 0) : vec3(1, 0, 0);
      u = u.minus(f.times(u.dot(f)));
    }
    u = u.normalized();

    let r = u.cross(f);
    if (r.norm() < 1e-5) r = vec3(1, 0, 0);
    r = r.normalized();

    u = f.cross(r).normalized();

    return Matrix.of(
      [r[0], r[1], r[2], 0],
      [u[0], u[1], u[2], 0],
      [f[0], f[1], f[2], 0],
      [0,    0,    0,    1]
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
    const hand = Mat4.translation(...handPos)
      .times(Mat4.scale(
        ARM_CONFIG.handRadius,
        ARM_CONFIG.handRadius,
        ARM_CONFIG.handRadius
      ));

    this.shapes.sphere.draw(caller, this.uniforms, hand, this.materials.glove);
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

  draw_cow(caller, cx, cy, cz, yaw = 0) {
    // A Holstein dairy cow (black and white) grazing in the field.
    // yaw rotates the whole cow around its vertical axis (radians).
    // All proportions and colours match a real cow.

    const S = this.shapes;
    const M = this.uniforms;
    const white  = this.materials.cow_white;
    const black  = this.materials.cow_black;
    const pink   = this.materials.cow_pink;
    const hoof   = this.materials.cow_hoof;
    const horn   = this.materials.cow_horn;

    // All cow parts are defined in local space (cow faces +z),
    // then rotated by yaw around the cow's origin.
    const cowT = (lx, ly, lz, preRot = Mat4.identity()) => {
      return Mat4.translation(cx, 0, cz)
        .times(Mat4.rotation(yaw, 0, 1, 0))
        .times(Mat4.translation(lx, ly, lz))
        .times(preRot);
    };

    // ── Body ────────────────────────────────────────────────────────────────
    S.sphere.draw(caller, M,
      cowT(0, cy + 1.55, 0).times(Mat4.scale(0.72, 0.62, 1.45)), white);

    // Black patch left-flank (Holstein marking)
    S.sphere.draw(caller, M,
      cowT(-0.55, cy + 1.65, 0.15).times(Mat4.scale(0.28, 0.38, 0.62)), black);

    // Black patch back-rump
    S.sphere.draw(caller, M,
      cowT(0.18, cy + 1.82, -0.85).times(Mat4.scale(0.42, 0.32, 0.38)), black);

    // ── Neck & head (grazing pose – head angled down) ───────────────────────
    S.sphere.draw(caller, M,
      cowT(0, cy + 1.62, 1.28, Mat4.rotation(Math.PI * 0.28, 1, 0, 0))
        .times(Mat4.scale(0.28, 0.28, 0.42)), white);

    // Black neck patch
    S.sphere.draw(caller, M,
      cowT(-0.10, cy + 1.56, 1.35, Mat4.rotation(Math.PI * 0.28, 1, 0, 0))
        .times(Mat4.scale(0.18, 0.18, 0.25)), black);

    // Head
    S.sphere.draw(caller, M,
      cowT(0, cy + 1.26, 1.68, Mat4.rotation(Math.PI * 0.18, 1, 0, 0))
        .times(Mat4.scale(0.24, 0.22, 0.38)), white);

    // Snout
    S.sphere.draw(caller, M,
      cowT(0, cy + 0.98, 1.94).times(Mat4.scale(0.155, 0.12, 0.14)), pink);

    // Nostrils
    S.sphere.draw(caller, M,
      cowT(-0.07, cy + 0.95, 2.07).times(Mat4.scale(0.028, 0.022, 0.025)), black);
    S.sphere.draw(caller, M,
      cowT( 0.07, cy + 0.95, 2.07).times(Mat4.scale(0.028, 0.022, 0.025)), black);

    // Eyes
    S.sphere.draw(caller, M,
      cowT(-0.20, cy + 1.32, 1.90).times(Mat4.scale(0.042, 0.038, 0.030)), black);
    S.sphere.draw(caller, M,
      cowT( 0.20, cy + 1.32, 1.90).times(Mat4.scale(0.042, 0.038, 0.030)), black);

    // Ears
    S.sphere.draw(caller, M,
      cowT(-0.26, cy + 1.46, 1.72).times(Mat4.scale(0.12, 0.07, 0.06)), white);
    S.sphere.draw(caller, M,
      cowT( 0.26, cy + 1.46, 1.72).times(Mat4.scale(0.12, 0.07, 0.06)), white);

    // Horns
    S.post.draw(caller, M,
      cowT(-0.18, cy + 1.56, 1.60,
        Mat4.rotation(-Math.PI * 0.35, 0, 0, 1).times(Mat4.rotation(-Math.PI * 0.1, 1, 0, 0)))
        .times(Mat4.scale(0.035, 0.035, 0.16)), horn);
    S.post.draw(caller, M,
      cowT( 0.18, cy + 1.56, 1.60,
        Mat4.rotation( Math.PI * 0.35, 0, 0, 1).times(Mat4.rotation(-Math.PI * 0.1, 1, 0, 0)))
        .times(Mat4.scale(0.035, 0.035, 0.16)), horn);

    // ── Legs ────────────────────────────────────────────────────────────────
    const draw_leg = (lx, lz, black_upper) => {
      const mat_upper = black_upper ? black : white;
      S.sphere.draw(caller, M,
        cowT(lx, cy + 0.82, lz).times(Mat4.scale(0.14, 0.48, 0.14)), mat_upper);
      S.sphere.draw(caller, M,
        cowT(lx, cy + 0.26, lz).times(Mat4.scale(0.11, 0.30, 0.11)), white);
      S.sphere.draw(caller, M,
        cowT(lx, cy + 0.05, lz).times(Mat4.scale(0.13, 0.07, 0.14)), hoof);
    };

    draw_leg(-0.38,  0.82, true);
    draw_leg( 0.38,  0.82, false);
    draw_leg(-0.36, -0.85, false);
    draw_leg( 0.36, -0.85, true);

    // ── Udder ───────────────────────────────────────────────────────────────
    S.sphere.draw(caller, M,
      cowT(0, cy + 0.78, -0.42).times(Mat4.scale(0.30, 0.18, 0.24)), pink);

    for (const [tx, tz] of [[-0.12, -0.08], [0.12, -0.08], [-0.10, 0.10], [0.10, 0.10]]) {
      S.sphere.draw(caller, M,
        cowT(tx, cy + 0.58, -0.42 + tz).times(Mat4.scale(0.038, 0.065, 0.038)), pink);
    }

    // ── Tail ────────────────────────────────────────────────────────────────
    S.post.draw(caller, M,
      cowT(0, cy + 1.62, -1.40, Mat4.rotation(Math.PI * 0.15, 1, 0, 0))
        .times(Mat4.scale(0.048, 0.048, 0.38)), white);

    S.sphere.draw(caller, M,
      cowT(0, cy + 1.38, -1.76).times(Mat4.scale(0.10, 0.10, 0.10)), black);
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
    for (const x of [-16, 16]) {
      for (let z = -16; z >= -82; z -= 10) {
        const post_t = Mat4.translation(x, 1.2, z).times(Mat4.scale(0.12, 1.2, 0.12));
        this.shapes.post.draw(caller, this.uniforms, post_t, this.materials.wood);
      }

      const rail1 = Mat4.translation(x, 1.8, 0).times(Mat4.scale(0.06, 0.06, 300));
      const rail2 = Mat4.translation(x, 0.95, 0).times(Mat4.scale(0.05, 0.05, 300));
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

    // Herd of Holstein cows scattered across the field.
    // Kept well outside the shooting lane (|x| > 7) and away from target z positions.
    // Each cow has a distinct yaw so they face different directions.
    const cow_herd = [
      { x: -10,  z: -28,  yaw: 0.0              },
      { x: -13,  z: -18,  yaw: 2.4              },
      { x: -11,  z: -50,  yaw: 1.1              },
      { x: -14,  z: -72,  yaw: Math.PI          },
      { x:  10,  z: -22,  yaw: -0.7             },
      { x:  12,  z: -45,  yaw: Math.PI * 0.6    },
      { x:  13,  z: -68,  yaw: -2.1             },
      { x: -16,  z: -35,  yaw: 0.5              },
      { x:  15,  z: -33,  yaw: Math.PI * 1.4    },
    ];
    for (const c of cow_herd) {
      this.draw_cow(caller, c.x, 0, c.z, c.yaw);
    }
  }

  draw_arrow_mesh(caller, pos, dir) {
    const basis = this.get_basis_from_dir(dir);

    const shaft_radius = 0.02;
    const shaft_length = 3.2;

    const shaft_transform = Mat4.translation(...pos)
      .times(basis)
      .times(Mat4.translation(0, 0, shaft_length / 2))
      .times(Mat4.scale(shaft_radius, shaft_radius, shaft_length / 2));

    const head_length = 0.28;
    const head_radius = 0.045;
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
        .times(Mat4.scale(0.008, 0.12, 0.35));

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

    // Only show the latter part of the upper arm so it feels like it comes from off screen
    const upperVisibleStart = shoulder.plus(solved.elbow.minus(shoulder).times(0.55));
    this.draw_segment(
      caller,
      upperVisibleStart,
      solved.elbow,
      ARM_CONFIG.upperArmRadius,
      this.materials.sleeve
    );

    // Show full forearm
    this.draw_segment(
      caller,
      solved.elbow,
      solved.hand,
      ARM_CONFIG.foreArmRadius,
      this.materials.sleeve
    );

    // Wrist / cuff
    const wristStart = solved.elbow.plus(solved.hand.minus(solved.elbow).times(0.78));
    this.draw_segment(
      caller,
      wristStart,
      solved.hand,
      ARM_CONFIG.wristRadius,
      this.materials.cuff
    );

    // Elbow joint
    this.draw_joint(caller, solved.elbow, 0.090, this.materials.sleeve);

    // Slight offset so the hand sits naturally at the end of the arm
    const handCenter = solved.hand;

    this.draw_hand(
      caller,
      handCenter,
      handForward,
      handSide,
      handUp,
      this.materials.glove,
      this.materials.glove
    );

    return solved;
  }

  draw_bow_rig(caller) {
    const setup = this.get_bow_setup();
    const { dir, axes, bowGrip, nockPos, leftShoulder, rightShoulder, bowTop, bowBottom } = setup;

    // Bend hints keep elbows pointing naturally outward relative to the current aim direction
    const leftBendHint =
      axes.right.times(-1.45).plus(axes.up.times(-0.95)).plus(dir.times(0.20));
    const rightBendHint =
      axes.right.times( 1.45).plus(axes.up.times(-0.95)).plus(dir.times(0.10));

    this.draw_arm_ik(caller, rightShoulder, nockPos, rightBendHint, dir, axes.right, axes.up, true);

    // Bow body
    const bow_transform = Mat4.translation(...bowGrip)
      .times(this.get_basis_from_forward_up(dir, axes.up))
      .times(Mat4.rotation(Math.PI / 2, 0, 1, 0))
      .times(Mat4.scale(0.07, 1.25, 0.05));
    this.shapes.bow_arc.draw(caller, this.uniforms, bow_transform, this.materials.bow_dark);

    // Grip block
    const grip_transform = Mat4.translation(...bowGrip)
      .times(this.get_basis_from_forward_up(dir, axes.up))
      .times(Mat4.scale(0.045, 0.20, 0.045));
    this.shapes.post.draw(caller, this.uniforms, grip_transform, this.materials.wood);

    // Nocked arrow
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

        const impact_dir = a.get_direction();

        a.stuck = true;
        a.stuck_dir = impact_dir;
        a.stuck_target_index = i;
        a.vel = vec3(0, 0, 0);

        const visible_stuck_pos = hit_pos.plus(vec3(0, 0, 0.45));
        a.stuck_offset = visible_stuck_pos.minus(center);
        a.pos = visible_stuck_pos;

        break;
      }
      }
    }
  }
resolve_arrow_cow_collisions() {
    for (const a of this.arrows) {
      if (!a.alive || a.stuck) continue;

      for (const cow of this.cow_bounds) {
        const dx = a.pos[0] - cow.x;
        const dy = a.pos[1] - cow.y;
        const dz = a.pos[2] - cow.z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

        if (dist <= cow.r) {
          // Hit a cow — lose all points and streak
          this.score = 0;
          this.streak = 0;
          a.alive = false;
          this.trigger_penalty_flash();
          break;
        }
      }
    }
  }

  update_stuck_arrows() {
  for (const a of this.arrows) {
    if (!a.stuck) continue;
    if (a.stuck_target_index === null) continue;

    const center = this.target_centers[a.stuck_target_index];
    a.pos = center.plus(a.stuck_offset);
  }
}
  update_simulation(dt) {
    this.weather.update(dt);
    this.update_targets(dt);
    this.update_arrows(dt);
    this.resolve_arrow_target_collisions();
    this.resolve_arrow_cow_collisions();
    this.update_stuck_arrows();
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

    const t = Mat4.translation(...pos).times(Mat4.scale(0.07, 0.07, 0.07));
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
    let dir;

    if (a.stuck && a.stuck_dir) {
      dir = a.stuck_dir;
    } else {
      dir = a.get_direction();
      dir = vec3(-dir[0], dir[1], dir[2]);
    }

    this.draw_arrow_mesh(caller, a.pos, dir);
  }
}

  /* ---------- UI Controls ---------- */

  render_controls() {
    // Before (jittery — fires on OS key-repeat):
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

    // After (keep them for the visible UI buttons, but disable the key callback):
    this.key_triggered_button('Aim Left',  [], () => this.aim_yaw += this.aim_sensitivity);
    this.key_triggered_button('Aim Right', [], () => this.aim_yaw -= this.aim_sensitivity);
    this.key_triggered_button('Aim Up',    [], () => { this.aim_pitch = Math.min(this.aim_pitch + this.aim_sensitivity, 0.45); });
    this.key_triggered_button('Aim Down',  [], () => { this.aim_pitch = Math.max(this.aim_pitch - this.aim_sensitivity, -0.45); });
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
      defs.Phong_Shader.light_source(vec4(25, 40, 10, 1), color(1, 1, 1, 1), 2200),
      defs.Phong_Shader.light_source(vec4(-40, 30, -80, 1), color(0.7, 0.75, 0.9, 1), 900),
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

    // Smooth per-frame aim input
  if (this.held_keys?.['ArrowLeft'])  this.aim_yaw  += this.aim_sensitivity;
  if (this.held_keys?.['ArrowRight']) this.aim_yaw  -= this.aim_sensitivity;
  if (this.held_keys?.['ArrowUp'])    this.aim_pitch = Math.min(this.aim_pitch + this.aim_sensitivity, 0.45);
  if (this.held_keys?.['ArrowDown'])  this.aim_pitch = Math.max(this.aim_pitch - this.aim_sensitivity, -0.45);
 

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