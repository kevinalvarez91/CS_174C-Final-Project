# Bullseye Range: An Interactive Archery Simulation

**Authors:** Kevin Alvarez Campos, Payton Cavanagh, Daniel Sanchez Cruz

---

## Abstract

In this simulation, we modeled a first-person archery range experience rendered in real-time 3D using the UCLA Tiny Graphics JavaScript library. The player draws a bow, fires arrows at moving bullseye targets, and contends with dynamic weather conditions including wind, rain, and snow that physically affect arrow trajectories. We used splines to define the curved trajectory preview that guides the player's aim. The simulation includes a full scoring system with streaks, multiple arrow speed presets, and an animated first-person bow rig with inverse kinematics. We are satisfied with the results; the arrow physics feel responsive, the weather effects are visually convincing, and the targets move in naturalistic Lissajous paths that keep gameplay engaging.

---

## 1. Introduction

Archery simulations are compelling interactive experiences because they require the player to reason about projectile physics — gravity, initial speed, draw strength, and wind — without any direct feedback until the moment of impact. The challenge of leading a moving target while compensating for environmental forces makes even a simple archery range feel skill-based and rewarding.

Our simulation, **Bullseye Range**, places the player at a stationary firing position in an open outdoor environment. Two targets hang at different distances and move continuously along Lissajous curves. The player aims using arrow-key inputs, charges a draw by holding the spacebar, and releases to fire. A dotted trajectory preview arc, computed using splines, appears while drawing to help the player plan their shot. Arrows are subject to gravity and wind force, and scoring is determined by how close the arrow lands to the center of the target.

The game includes a weather system that cycles through four states — clear, windy, rainy, and snowy — each of which alters the wind vector applied to arrows in flight and changes the visual appearance of the scene accordingly. The simulation is written in JavaScript using the UCLA Tiny Graphics WebGL library and runs entirely in a web browser.

---

## 2. Related Work

The projectile motion model underlying the arrow physics is standard Newtonian kinematics: a constant gravitational acceleration is applied each frame, and a wind acceleration vector derived from the current weather preset is added alongside it. This is consistent with classical treatments of ballistic trajectory simulation used widely in games.

The animated bow arm rig is solved using a two-bone inverse kinematics (IK) algorithm, a technique described extensively in game animation literature. Given a shoulder position and a target endpoint (the bow grip or nock), the IK solver finds the elbow position that satisfies the two-bone chain using the law of cosines, projecting a bend hint vector to ensure the elbow bends in a natural direction.

The moving targets follow Lissajous curves, a well-known family of parametric curves defined by independently oscillating sine functions on two axes. By choosing incommensurable frequency ratios, the targets trace smooth, non-repeating (or slowly repeating) figures that feel organic rather than mechanical.

---

## 3. Simulation Components

### 3.1. Arrow

Each arrow is a simple physics object that stores a position, a previous position, and a velocity vector. On every frame update, a combined acceleration — gravity on the Y-axis plus the weather-derived wind vector on X and Z — is integrated into the velocity, and the velocity is integrated into the position. When an arrow's Y-coordinate drops below the floor threshold it is marked dead and removed from the scene.

The arrow mesh is composed of a cylindrical shaft, a metallic cone tip, three evenly spaced vane fins (fletching) rotated 120 degrees apart around the shaft axis, and a small nock cylinder at the tail. All components are oriented along the arrow's current velocity direction using a dynamically computed orthonormal basis.

### 3.2. Moving Targets

Each target is parameterized by a base center position, a radius, a depth, and independent amplitudes and frequencies for horizontal and vertical oscillation. The `get_center()` method returns:

```
x(t) = base_x + amp_x * sin(freq_x * t)
y(t) = base_y + amp_y * sin(freq_y * t)
```

Because the two frequencies are incommensurable (e.g., 1.2 and 2.4, or 0.8 and 0.4), the target traces a Lissajous figure that does not close quickly, keeping the target's position visually unpredictable.

Each target is rendered as a stack of five concentric cylinders of decreasing radius, colored from outermost to innermost as white, black, blue, red, and gold — matching the standard archery target color convention. The rings are layered with a small Z offset between them to prevent depth-fighting artifacts.

### 3.3. Weather System

The weather system maintains a pool of up to 400 particles and cycles through four presets: clear, wind, rain, and snow. Each preset defines a spawn rate, a wind strength and angle used to compute the wind acceleration vector, and particle appearance parameters (lifetime, velocity ranges, color, and scale).

Particles are small screen-facing squares translated each frame by their velocity. Rain particles are tall and thin with high downward speed; snow particles are larger, slower, and white; wind particles are semi-transparent horizontal streaks. When the weather is clear, no particles are spawned and any existing particles are purged.

The wind vector derived from each preset is:

```
wind = vec3(strength * cos(angle), 0, strength * sin(angle))
```

This vector is applied as an additional acceleration to every arrow in flight, causing trajectories to drift visibly in windy or stormy conditions.

### 3.4. Bow Rig and Arm Animation

The first-person view shows two arms holding a bow. Each arm is solved independently with a two-bone IK chain: a shoulder anchor point (fixed relative to the camera), a target end-effector (the bow grip for the left arm and the nock position for the right arm), and a bend-hint vector that biases the elbow outward in a natural direction.

The law-of-cosines solution for the elbow angle is:

```
cos(shoulder_angle) = (l1² + d² - l2²) / (2 * l1 * d)
elbow = shoulder + dir * l1 * cos(θ) + bendDir * l1 * sin(θ)
```

Each arm segment is rendered as a cylinder oriented along the direction from one joint to the next using `draw_segment`. A sphere is drawn at each elbow joint for continuity. Sleeve, cuff, and glove materials give the arms a clothing-layered appearance. The bow itself is a torus scaled into an oval arc, with a wooden grip cylinder at center and two thin string segments running from the bow tips to the nock point.

As the player holds the spacebar, `draw_strength` increases from 0 to 1, pulling the nock position progressively farther behind the grip. This visually communicates draw charge and scales the arrow's launch speed accordingly.

---

## 4. Spline-Based Trajectory Preview

While the player is drawing the bow, a dotted preview arc is rendered to show the predicted flight path. We used **splines** to compute and visualize this curved path through 3D space. Starting from the nock position with the current launch velocity, we used splines to step forward in time, accumulating gravity and wind at each step and placing a small dot-sphere at each point along the curve.

Up to 28 sample points are plotted, with the iteration terminating early if the projected position drops below the floor. The dots are rendered as small red subdivision spheres scaled to 0.055 units, forming a smooth dotted arc that bends convincingly under gravity and drifts laterally in wind conditions.

This spline-based preview is a key gameplay affordance: because arrow speed varies with draw strength and wind conditions change between shots, the trajectory arc gives the player real-time feedback so they can adjust their aim angle before releasing.

---

## 5. Collision Detection

Arrow-to-target collision is resolved using a continuous crossing test on the Z-axis rather than a simple point-in-sphere test. For each live, unstuck arrow, we check whether the Z-coordinate of the arrow's trajectory segment crosses the Z-plane of the target's center between the previous frame's position and the current frame's position:

```
crossesPlane = (z_prev - z_target) * (z_curr - z_target) <= 0
```

If the plane is crossed, a parametric interpolation finds the exact hit position on that plane:

```
t_hit = (z_target - z_prev) / (z_curr - z_prev)
hit_pos = prev_pos + (curr_pos - prev_pos) * t_hit
```

The radial distance from this hit position to the target center is then compared against the target radius. If the arrow lands within the target, it is scored based on which concentric ring it fell into, the arrow is marked as stuck, its velocity is zeroed, and its position is fixed slightly forward of the target face so it appears embedded.

Scoring bands are:

| Radius Fraction | Points |
|---|---|
| 0.0 – 0.2 (gold) | 10 |
| 0.2 – 0.4 (red) | 8 |
| 0.4 – 0.6 (blue) | 6 |
| 0.6 – 0.8 (black) | 4 |
| 0.8 – 1.0 (white) | 2 |

A streak counter increments for any shot scoring 8 or above and resets otherwise. Shots scoring 6 or above trigger a scoreboard flash animation.

---

## 6. Scene and Environment

### 6.1. Environment Layout

The environment is a fixed outdoor archery range. The ground is a large scaled square plane. A shooting lane with a slightly brighter green strip runs forward from the player's starting position. Wooden fence posts and horizontal rails line both sides of the lane. The two targets hang at approximately 40 and 60 units forward of the player, at heights of 4 and 6 units respectively.

### 6.2. Vegetation

Trees are procedurally assembled from a set of geometric primitives. Each tree is composed of a cylindrical trunk and four stacked cone-frustum foliage layers of decreasing radius, using three shades of green (dark, mid, light) to simulate depth. Three small sphere clumps are placed asymmetrically on each tree to break the perfect conical silhouette and give a more organic appearance. Eighteen trees of varying height and canopy scale are distributed along both sides of the range.

### 6.3. Mountains and Sky

A backdrop of five procedurally placed mountain formations is visible at the far end of the range. Each mountain is built from a tall primary cone, two secondary flanking peaks, a sharp front spike, and a small jagged spike, with a snow cap that appears only in rain and snow weather modes. Material colors shift per weather condition — darker and more saturated in rain, slightly desaturated in snow.

The sky is a large inverted sphere surrounding the entire scene. Its color shifts from a bright blue in clear or wind conditions to a dark grey in rain and snow. A sun sphere with a texture is rendered in clear and wind weather; it is hidden during precipitation. Clouds are rendered as blobs of five overlapping spheres, with material swapped to a darker storm variant during rain and snow.

### 6.4. Lighting and Shading

All scene objects use Phong shading with two light sources: a primary warm white directional light positioned above and forward-right of the scene, and a secondary cooler fill light positioned to the left and far back. Weather particles use an ambient-only unlit material so they are not affected by scene lighting.

---

## 7. User Interface

The HUD consists of two overlay elements injected directly into the DOM. A scoreboard panel at the top center of the screen displays the current score, shots taken out of the maximum twenty, the active streak count, the weather mode, and the selected arrow speed. When the player scores 6 or more points on a shot, the scoreboard briefly flashes with a yellow glow animation.

A crosshair is rendered at the viewport center using four short line segments and a central dot, all white with a soft glow shadow. The crosshair is not affected by aim offset, serving as a fixed reference for where the arrow will fly.

Keyboard controls are:

| Key | Action |
|---|---|
| Arrow Keys | Aim (yaw and pitch) |
| Space (hold/release) | Draw and fire |
| Q | Cycle weather |
| E | Cycle arrow speed |
| R | Reset game |

Arrow speed cycles through three presets (60, 180, 300 units/second base speed), and actual launch speed is scaled by draw strength at the moment of release.

---

## 8. Evaluation

We evaluated the simulation on three axes: physical plausibility of arrow flight, visual coherence of the scene across weather modes, and responsiveness of gameplay.

Arrow flight feels physically convincing. At slow speed, gravity causes a pronounced arc that requires deliberate upward aim to compensate; at fast speed, the arrow flies nearly flat across the shorter distance. Wind drift at the highest weather intensity visibly pushes arrows sideways, requiring the player to lead into the wind. The spline trajectory preview accurately predicts this behavior, so the player has sufficient information to compensate.

Visual transitions between weather modes are immediate and clear. The sky, clouds, mountains, and scoreboard all update simultaneously when the weather is cycled, and the particle systems for rain, snow, and wind are visually distinct. Snow particles are large and slow; rain particles are fast, thin, and near-vertical; wind particles are semi-transparent horizontal streaks.

Gameplay is responsive. Aim movement is direct and linear with no acceleration curve. The draw strength builds at a constant rate, and the trajectory arc updates every frame in real time so the player can watch their predicted landing point shift as they charge.

The primary limitation is that the targets do not react to being hit beyond accepting the stuck arrow. Future work could include target knockback, a congratulatory effect, or target respawning after a delay.

---

## 9. Conclusion

We built a complete, interactive first-person archery simulation running in a web browser using the UCLA Tiny Graphics WebGL library. Reynolds-style force integration governs arrow physics, a two-bone IK solver animates the bow arms, Lissajous motion keeps the targets moving organically, and a particle-based weather system modifies both the visual environment and the physical forces acting on arrows in flight. We used splines throughout to compute the smooth trajectory preview arc that gives the player real-time aiming guidance.

In future work we would like to add more target types at varying distances, introduce a round-based progression structure, and add audio feedback for arrow release and impact. We would also like to explore more sophisticated wind models that vary over time rather than remaining constant within a weather preset, and potentially add a full ballistics model accounting for arrow mass and drag.

---

## References

Reynolds, C. W. Steering behaviors for autonomous characters. In *Proceedings of Game Developers Conference 1999*, San Jose, California. Miller Freeman Game Group, San Francisco, California, pp. 763–782, 1999.

Lander, J. Making Kine More Flexible. *Game Developer Magazine*, November 1998. (Two-bone IK techniques for game characters.)

Bowyer, A. and Woodwark, J. *A Programmer's Geometry*. Butterworths, 1983. (Orthonormal basis construction and geometric primitives.)