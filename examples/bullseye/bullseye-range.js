import { tiny, defs } from '../common.js';

const {
  vec3, vec4, color, Mat4, Matrix, Shader, Component,
} = tiny;

const { Square, Subdivision_Sphere, Capped_Cylinder, Torus, Phong_Shader } = defs;

/* =========================
   Tunable Constants
========================= */
const GAME_CONFIG = {
  maxShots: 20,
  gravity: -15.0,
  baseArrowSpeed: 60,
  aimSensitivity: 0.04,
  maxDrawStrength: 1.0,
  drawChargeRate: 1.2,       // per second
  playerHeight: 2.0,
  arrowSpawnForward: 1.0,
  dtClamp: 1 / 30,           // prevent huge simulation jumps on lag spikes
};

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

    // Optional cleanup when changing weather so old effects don't linger too long
    if (this.type === 'clear') this.particles.length = 0;
  }

  spawn_particle() {
    const preset = this.preset;
    if (!preset.particle || this.particles.length >= this.max_particles) return;

    const p = preset.particle;
    const base_pos = vec3(
      randRange(-30, 30),
      randRange(15, 20),
      randRange(-80, -20)
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

      // Cull if too far below the scene (helps prevent buildup)
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

    // Treat wind vector as acceleration for curved flight
    const accel = vec3(wind_accel[0], gravity + wind_accel[1], wind_accel[2]);
    this.vel = this.vel.plus(accel.times(dt));
    this.pos = this.pos.plus(this.vel.times(dt));

    // Ground hit
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
    console.log("FORCE UPDATING"); 
    this.widget_options = { make_controls: true };

    this.shapes = {
      ground: new Square(),
      target_face: new Capped_Cylinder(30, 30),
      post: new Capped_Cylinder(4, 12),
      arrow_shaft: new Capped_Cylinder(6, 12),
      arrow_head: new Subdivision_Sphere(3),
      bow_arc: new Torus(15, 15),
      dot: new Subdivision_Sphere(2),
      sphere: new Subdivision_Sphere(4), 
    };

    const phong = new Phong_Shader(1);
    this.materials = {
      ground:       { shader: phong, color: color(0.25, 0.4, 0.2, 1), ambient: 0.4, diffusivity: 0.6 },
      target_white: { shader: phong, color: color(0.9, 0.9, 0.9, 1), ambient: 0.5, diffusivity: 0.8 },
      target_black: { shader: phong, color: color(0.1, 0.1, 0.1, 1), ambient: 0.5, diffusivity: 0.8 },
      target_blue:  { shader: phong, color: color(0.2, 0.6, 0.9, 1), ambient: 0.5, diffusivity: 0.8 },
      target_red:   { shader: phong, color: color(0.8, 0.2, 0.2, 1), ambient: 0.5, diffusivity: 0.8 },
      target_gold:  { shader: phong, color: color(0.9, 0.8, 0.1, 1), ambient: 0.6, diffusivity: 0.8 },
      wood:         { shader: phong, color: color(0.4, 0.25, 0.1, 1), ambient: 0.4, diffusivity: 0.8 },
      arrow:        { shader: phong, color: color(0.8, 0.8, 0.8, 1), ambient: 0.5, diffusivity: 0.8 },
      particles:    { shader: phong, color: color(1, 1, 1, 0.7), ambient: 1.0, diffusivity: 0.0 },
      dot:          { shader: phong, color: color(1, 0, 0, 0.6), ambient: 1.0, diffusivity: 0.0 },
      sky:    { shader: phong, color: color(0.4, 0.7, 0.9, 1), ambient: 1.0, diffusivity: 0.0 }, // 1.0 ambient so it doesn't get dark
      leaves: { shader: phong, color: color(0.1, 0.4, 0.15, 1), ambient: 0.4, diffusivity: 0.8 },
      hill:   { shader: phong, color: color(0.2, 0.35, 0.15, 1), ambient: 0.3, diffusivity: 0.9 },
    };

    this.reset_game();

    // --- NEW: HTML/CSS Scoreboard Overlay ---
    this.scoreboard_el = document.createElement('div');
    
    // Style it to look like a digital display
    Object.assign(this.scoreboard_el.style, {
      position: 'absolute',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',         // Centers the div
      backgroundColor: 'rgba(5, 15, 5, 0.85)', // Dark greenish-black background
      border: '3px solid #0f0',              // Bright green border
      color: '#0f0',                         // Bright green text
      fontFamily: '"Courier New", Courier, monospace', // Digital/retro font
      padding: '15px 30px',
      fontSize: '24px',
      fontWeight: 'bold',
      borderRadius: '10px',
      boxShadow: '0 0 15px rgba(0, 255, 0, 0.5)', // Outer glow
      textShadow: '0 0 8px #0f0',            // Text glow
      pointerEvents: 'none',                 // Lets mouse clicks pass through to the game
      zIndex: '1000',                        // Keeps it on top of the canvas
      textAlign: 'center',
      whiteSpace: 'pre'                      // Keeps our exact spacing
    });

    document.body.appendChild(this.scoreboard_el);

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
    this.score = 0;
    this.shots_taken = 0;
    this.max_shots = GAME_CONFIG.maxShots;
    this.streak = 0;

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

  get_weather_wind_vector() {
    const preset = this.weather.preset;
    const s = preset.windStrength;
    const a = preset.windAngle;
    return vec3(s * Math.cos(a), 0, s * Math.sin(a));
  }

  current_aim_direction() {
    const cy = Math.cos(this.aim_yaw),   sy = Math.sin(this.aim_yaw);
    const cp = Math.cos(this.aim_pitch), sp = Math.sin(this.aim_pitch);
    return vec3(sy * cp, sp, -cy * cp).normalized();
  }

  get_player_origin() {
    return vec3(0, GAME_CONFIG.playerHeight, 0);
  }

  compute_arrow_speed() {
    return GAME_CONFIG.baseArrowSpeed * (0.2 + 0.8 * this.draw_strength);
  }

  score_for_radius_fraction(frac) {
    for (const band of TARGET_SCORING) {
      if (frac <= band.frac) return band.points;
    }
    return 0;
  }

  trigger_scoreboard_flash() {
    if (!this.scoreboard_el) return;
    
    // Remove the class, trigger a layout reflow, and add it back to restart the animation
    this.scoreboard_el.classList.remove('flash-active');
    void this.scoreboard_el.offsetWidth; // Magic browser trick to reset CSS animations
    this.scoreboard_el.classList.add('flash-active');
  }

  draw_scenery(caller) {
    // 1. Skybox (A massive sphere wrapped around the scene)
    const sky_transform = Mat4.scale(150, 150, 150);
    this.shapes.sphere.draw(caller, this.uniforms, sky_transform, this.materials.sky);

    // 2. Expanded Ground (Scale it up so we don't see the edges easily)
    const ground_transform = Mat4.translation(0, 0, -40)
      .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
      .times(Mat4.scale(150, 150, 1));
    this.shapes.ground.draw(caller, this.uniforms, ground_transform, this.materials.ground);

    // 3. Distant Rolling Hills (Stretched spheres)
    const hill_positions = [
      vec3(-40, -5, -100), vec3(40, -8, -110), vec3(0, -10, -120)
    ];
    for (const pos of hill_positions) {
      const hill_transform = Mat4.translation(...pos)
        .times(Mat4.scale(40, 20, 20)); // Stretch them wide and tall
      this.shapes.sphere.draw(caller, this.uniforms, hill_transform, this.materials.hill);
    }

    // 4. Trees lining the sides
    const tree_z_positions = [-20, -40, -60, -80];
    for (const z of tree_z_positions) {
      // Draw a tree on the left and right for each Z depth
      for (const x of [-25, 25]) {
        // Trunk
        const trunk_transform = Mat4.translation(x, 2, z)
          .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
          .times(Mat4.scale(1, 1, 4));
        this.shapes.post.draw(caller, this.uniforms, trunk_transform, this.materials.wood);

        // Leaves
        const leaves_transform = Mat4.translation(x, 6, z)
          .times(Mat4.scale(4, 5, 4)); // Slightly oval leaves
        this.shapes.sphere.draw(caller, this.uniforms, leaves_transform, this.materials.leaves);
      }
    }
  }

  // Stable orientation basis from direction vector
  get_basis_from_dir(dir) {
    const forward = dir.normalized();
    let upHint = vec3(0, 1, 0);

    // If nearly parallel, switch up reference
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

  draw_arrow_mesh(caller, pos, dir) {
    const basis = this.get_basis_from_dir(dir);

    const shaft_transform = Mat4.translation(...pos)
      .times(basis)
      .times(Mat4.scale(0.04, 0.04, 1.8));

    const head_transform = Mat4.translation(...pos.plus(dir.times(1.8)))
      .times(basis)
      .times(Mat4.scale(0.1, 0.1, 0.1));

    this.shapes.arrow_shaft.draw(caller, this.uniforms, shaft_transform, this.materials.arrow);
    this.shapes.arrow_head.draw(caller, this.uniforms, head_transform, this.materials.arrow);
  }

  /* ---------- Gameplay ---------- */

  spawn_arrow() {
    if (this.shots_taken >= this.max_shots) return;

    const dir = this.current_aim_direction();
    const start = this.get_player_origin().plus(dir.times(GAME_CONFIG.arrowSpawnForward));
    const speed = this.compute_arrow_speed();
    const wind = this.get_weather_wind_vector();

    // Keep your original behavior: initial velocity gets wind bias too
    const velocity = dir.times(speed).plus(wind);

    this.arrows.push(new Arrow(start, velocity));
    this.shots_taken++;
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

  // Continuous collision detection against target z-plane, then radial test in x/y
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

        // IMPORTANT: interpolate along the segment (prev -> current)
        const segment = a.pos.minus(a.prev_pos);
        const hit_pos = a.prev_pos.plus(segment.times(tHit));

        // Radial distance on the target face (ignore z)
        const dx = hit_pos[0] - center[0];
        const dy = hit_pos[1] - center[1];
        const r = Math.sqrt(dx * dx + dy * dy);

        if (r <= target.radius) {
          const ring_frac = r / target.radius;
          const points = this.score_for_radius_fraction(ring_frac);

          this.score += points;
          this.streak = points >= 8 ? this.streak + 1 : 0;

          if (points >= 6){
            this.trigger_scoreboard_flash(); 
          }

          a.stuck = true;
          a.vel = vec3(0, 0, 0);

          // Stick slightly in front of target toward player (positive z here)
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

  draw_bow_and_arrow(caller) {
    const dir = this.current_aim_direction();
    const origin = this.get_player_origin();
    const basis = this.get_basis_from_dir(dir);

    // Move bow slightly right/down in FPS view
    const bow_offset_local = vec4(0.3, -0.2, 0, 0);
    const bow_pos = origin
      .plus(dir.times(1.0))
      .plus(basis.times(bow_offset_local).to3());

    const draw_offset = this.draw_strength * 0.8;

    const bow_transform = Mat4.translation(...bow_pos)
      .times(basis)
      .times(Mat4.rotation(Math.PI / 2, 0, 1, 0))
      .times(Mat4.scale(0.3, 1.2, 0.3));

    this.shapes.bow_arc.draw(caller, this.uniforms, bow_transform, this.materials.wood);

    // Nocked arrow shown while available or while currently drawing
    if (this.shots_taken < this.max_shots || this.is_drawing) {
      const arrow_pos = bow_pos.plus(basis.times(vec4(-0.05, 0, -draw_offset + 0.8, 0)).to3());
      this.draw_arrow_mesh(caller, arrow_pos, dir);
    }
  }

  draw_trajectory(caller) {
    if (!this.is_drawing) return;

    const dir = this.current_aim_direction();
    let pos = this.get_player_origin().plus(dir.times(1.0));
    let vel = dir.times(this.compute_arrow_speed()).plus(this.get_weather_wind_vector());

    const wind = this.get_weather_wind_vector();
    const step = 0.1;
    const maxPoints = 20;

    for (let i = 0; i < maxPoints; i++) {
      vel = vel.plus(vec3(wind[0] * step, this.gravity * step + wind[1] * step, wind[2] * step));
      pos = pos.plus(vel.times(step));

      if (pos[1] < -2) break;

      const t = Mat4.translation(...pos).times(Mat4.scale(0.1, 0.1, 0.1));
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

      const post_transform = Mat4.translation(center[0], center[1] - target.radius - 2.0, center[2])
        .times(Mat4.scale(0.15, target.radius + 2.0, 0.15));
      this.shapes.post.draw(caller, this.uniforms, post_transform, this.materials.wood);

      // Slight z offset per ring prevents z-fighting
      let layer = 0;
      for (const ring of rings) {
        const z_offset = layer * 0.05;

        const face_transform = Mat4.translation(center[0], center[1], center[2] + z_offset)
          .times(Mat4.scale(target.radius * ring.frac, target.radius * ring.frac, target.depth));

        this.shapes.target_face.draw(caller, this.uniforms, face_transform, ring.material);
        layer++;
      }
    }
  }

  draw_arrows(caller) {
    for (const a of this.arrows) {
      const dir = a.stuck ? vec3(0, 0, -1) : a.get_direction();
      this.draw_arrow_mesh(caller, a.pos, dir);
    }
  }

  /* ---------- UI Controls ---------- */

  render_controls() {
    this.key_triggered_button('Aim Left', ['ArrowLeft'], () => this.aim_yaw -= this.aim_sensitivity);
    this.key_triggered_button('Aim Right', ['ArrowRight'], () => this.aim_yaw += this.aim_sensitivity);
    this.new_line();

    this.key_triggered_button('Aim Up', ['ArrowUp'], () => {
      this.aim_pitch = Math.min(this.aim_pitch + this.aim_sensitivity, 0.4);
    });
    this.key_triggered_button('Aim Down', ['ArrowDown'], () => {
      this.aim_pitch = Math.max(this.aim_pitch - this.aim_sensitivity, -0.4);
    });
    this.new_line();

    this.key_triggered_button(
      'Draw / Release',
      [' '],
      () => {
        // Prevent OS key-repeat from restarting draw
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
        }
      }
    );

    this.new_line();
    this.key_triggered_button('Cycle Weather', ['q'], () => this.weather.cycle_type(), 'blue');
    this.key_triggered_button('Reset Game', ['r'], () => this.reset_game(), 'orange');
    this.new_line();

    this.live_string(box => {
      box.textContent =
        `Score: ${this.score}   Shots: ${this.shots_taken}/${this.max_shots}   ` +
        `Streak: ${this.streak}   Weather: ${this.weather.type.toUpperCase()}`;
    });
  }

  /* ---------- Main Render Loop ---------- */

  render_animation(caller) {
    // Enforce first-person view
    caller.controls = null;

    const camera_matrix = Mat4.rotation(-this.aim_pitch, 1, 0, 0)
      .times(Mat4.rotation(-this.aim_yaw, 0, 1, 0))
      .times(Mat4.translation(0, -GAME_CONFIG.playerHeight, 0));

    Shader.assign_camera(camera_matrix, this.uniforms);

    this.uniforms.projection_transform = Mat4.perspective(
      Math.PI / 4,
      caller.width / caller.height,
      1,
      200
    );

    this.uniforms.lights = [
      defs.Phong_Shader.light_source(vec4(10, 20, 20, 1), color(1, 1, 1, 1), 400),
    ];

    let dt = this.uniforms.animation_delta_time / 1000;
    dt = Math.min(dt, GAME_CONFIG.dtClamp);

    if (this.uniforms.animate) {
      if (this.is_drawing) this.update_aim(true, dt);
      this.update_simulation(dt);
    }

    // const ground_transform = Mat4.translation(0, 0, -40)
    //   .times(Mat4.rotation(Math.PI / 2, 1, 0, 0))
    //   .times(Mat4.scale(80, 80, 1));

    // this.shapes.ground.draw(caller, this.uniforms, ground_transform, this.materials.ground);
    
    this.draw_scenery(caller); 
    this.draw_targets(caller);
    this.draw_arrows(caller);
    this.draw_bow_and_arrow(caller);
    this.draw_trajectory(caller);
    this.weather.draw(caller, this.uniforms, this.materials.particles);

    if (this.scoreboard_el) {
      // .padStart(4, '0') makes the score look like "0010" instead of "10"
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