"use strict";

const WIDTH = 480;
const HEIGHT = 270;
const GROUND_Y = 222;
const STEP = 1 / 60;
const ROUND_TIME = 60;
const ATTACK_DURATION = 0.36;
const ATTACK_COOLDOWN = 0.46;

const CONTROLS = [
  { left: "KeyA", right: "KeyD", jump: "KeyW", attack: "KeyF", guard: "KeyG" },
  { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", attack: "KeyK", guard: "KeyL" }
];

const PALETTES = [
  { main: "#28bfc0", dark: "#164b63", light: "#91f4dc", accent: "#ffe073", glow: "#39d9d0" },
  { main: "#e85c43", dark: "#742f40", light: "#ffae68", accent: "#ffe073", glow: "#ff6b45" }
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.gameKeys = new Set([...CONTROLS.flatMap(Object.values), "Enter", "NumpadEnter", "ArrowDown"]);

    window.addEventListener("keydown", event => {
      if (this.gameKeys.has(event.code)) event.preventDefault();
      if (!this.down.has(event.code)) this.pressed.add(event.code);
      this.down.add(event.code);
    });
    window.addEventListener("keyup", event => this.down.delete(event.code));
    window.addEventListener("blur", () => this.clear());
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endStep() { this.pressed.clear(); }
  clear() { this.down.clear(); this.pressed.clear(); }
}

class Fighter {
  constructor(id, x, facing) {
    this.id = id;
    this.name = id === 0 ? "苍蓝·猎隼" : "赤红·重锤";
    this.palette = PALETTES[id];
    this.x = x;
    this.y = GROUND_Y - 32;
    this.w = 22;
    this.h = 32;
    this.vx = 0;
    this.vy = 0;
    this.facing = facing;
    this.grounded = true;
    this.guarding = false;
    this.hp = 100;
    this.cooldown = 0;
    this.attackTimer = 0;
    this.hasHit = false;
    this.hurtTimer = 0;
    this.hitFlash = 0;
  }

  get centerX() { return this.x + this.w / 2; }
  get attackElapsed() { return ATTACK_DURATION - this.attackTimer; }
  get alive() { return this.hp > 0; }

  update(dt, input, controls) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dt);

    const canAct = this.hurtTimer <= 0;
    this.guarding = canAct && this.grounded && this.attackTimer <= 0 && input.isDown(controls.guard);

    if (canAct) {
      if (!this.guarding && this.attackTimer <= 0 && this.cooldown <= 0 && input.wasPressed(controls.attack)) {
        this.attackTimer = ATTACK_DURATION;
        this.cooldown = ATTACK_COOLDOWN;
        this.hasHit = false;
      }

      if (this.guarding) {
        this.vx = 0;
      } else {
        const direction = Number(input.isDown(controls.right)) - Number(input.isDown(controls.left));
        const speed = this.attackTimer > 0 ? 30 : 88;
        this.vx = direction * speed;
        if (direction !== 0 && this.attackTimer <= 0) this.facing = direction;

        if (input.wasPressed(controls.jump) && this.grounded && this.attackTimer <= 0) {
          this.vy = -205;
          this.grounded = false;
        }
      }
    } else {
      this.guarding = false;
      this.vx *= Math.pow(0.08, dt);
    }

    this.vy = Math.min(285, this.vy + 620 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.x = clamp(this.x, 23, WIDTH - 23 - this.w);

    if (this.y + this.h >= GROUND_Y) {
      this.y = GROUND_Y - this.h;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }

  faceOpponent(opponent) {
    if (this.guarding || this.attackTimer > 0 || this.hurtTimer > 0 || this.centerX === opponent.centerX) return;
    this.facing = this.centerX < opponent.centerX ? 1 : -1;
  }

  isAttackActive() {
    return this.attackTimer > 0 && this.attackElapsed >= 0.1 && this.attackElapsed <= 0.2;
  }

  attackBox() {
    return {
      x: this.facing > 0 ? this.x + this.w - 3 : this.x - 20,
      y: this.y + 7,
      w: 23,
      h: 18
    };
  }

  isBlocking(attacker) {
    const attackerDirection = Math.sign(attacker.centerX - this.centerX);
    return this.guarding && this.facing === attackerDirection;
  }

  receiveHit(attacker, blocked) {
    const damage = blocked ? 2 : 10;
    this.hp = Math.max(0, this.hp - damage);
    this.hitFlash = 0.13;
    this.vx = attacker.facing * (blocked ? 48 : 118);
    if (!blocked) {
      this.hurtTimer = 0.18;
      this.guarding = false;
      this.vy = -52;
      this.grounded = false;
      this.attackTimer = 0;
    }
    return damage;
  }

  animationState() {
    if (!this.alive) return "dead";
    if (this.hurtTimer > 0) return "hurt";
    if (this.attackTimer > 0) return "attack";
    if (this.guarding) return "guard";
    if (!this.grounded) return "jump";
    if (Math.abs(this.vx) > 2) return "run";
    return "idle";
  }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.input = new Input();
    this.renderer = new Renderer(this.ctx);
    this.phase = "title";
    this.timeLeft = ROUND_TIME;
    this.clock = 0;
    this.particles = [];
    this.shake = 0;
    this.winner = null;
    this.endReason = "ko";
    this.fighters = [new Fighter(0, 105, 1), new Fighter(1, 353, -1)];
    this.lastTime = 0;
    this.accumulator = 0;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  start() {
    this.fighters = [new Fighter(0, 105, 1), new Fighter(1, 353, -1)];
    this.timeLeft = ROUND_TIME;
    this.particles = [];
    this.shake = 0;
    this.winner = null;
    this.endReason = "ko";
    this.phase = "playing";
    this.input.clear();
  }

  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const frameTime = Math.min(0.1, (timestamp - this.lastTime) / 1000);
    this.lastTime = timestamp;
    this.accumulator += frameTime;

    while (this.accumulator >= STEP) {
      this.update(STEP);
      this.accumulator -= STEP;
    }
    this.renderer.draw(this);
    requestAnimationFrame(this.loop);
  }

  update(dt) {
    this.clock += dt;
    if (this.input.wasPressed("Enter") || this.input.wasPressed("NumpadEnter")) {
      if (this.phase !== "playing") this.start();
      this.input.endStep();
      return;
    }

    if (this.phase !== "playing") {
      this.updateParticles(dt);
      this.input.endStep();
      return;
    }

    const [a, b] = this.fighters;
    a.update(dt, this.input, CONTROLS[0]);
    b.update(dt, this.input, CONTROLS[1]);
    this.resolveBodyCollision(a, b);
    a.faceOpponent(b);
    b.faceOpponent(a);
    this.resolveAttacks(a, b);
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - 18 * dt);

    if (a.hp <= 0 || b.hp <= 0) {
      this.finish(a.hp === b.hp ? null : (a.hp > 0 ? a : b), "ko");
    } else {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.finish(a.hp === b.hp ? null : (a.hp > b.hp ? a : b), "time");
      }
    }
    this.input.endStep();
  }

  resolveBodyCollision(a, b) {
    if (!overlaps(a, b)) return;
    const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    if (overlap <= 0) return;
    if (a.centerX <= b.centerX) {
      a.x -= overlap / 2;
      b.x += overlap / 2;
    } else {
      a.x += overlap / 2;
      b.x -= overlap / 2;
    }
    a.x = clamp(a.x, 23, WIDTH - 23 - a.w);
    b.x = clamp(b.x, 23, WIDTH - 23 - b.w);
  }

  resolveAttacks(a, b) {
    const hits = [];
    for (const [attacker, defender] of [[a, b], [b, a]]) {
      if (attacker.alive && attacker.isAttackActive() && !attacker.hasHit && overlaps(attacker.attackBox(), defender)) {
        attacker.hasHit = true;
        hits.push({ attacker, defender, blocked: defender.isBlocking(attacker) });
      }
    }

    for (const hit of hits) {
      const { attacker, defender, blocked } = hit;
      defender.receiveHit(attacker, blocked);
      this.shake = blocked ? 1.2 : 2.8;
      this.spawnHit(defender.centerX + attacker.facing * -5, defender.y + 15, blocked, attacker.facing);
    }
  }

  spawnHit(x, y, blocked, direction) {
    const colors = blocked ? ["#8eb8ff", "#d9f3ff", "#4d69c6"] : ["#fff2ad", "#ff9c50", "#ff5545"];
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12;
      const speed = 35 + Math.random() * 85;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed + direction * 25,
        vy: Math.sin(angle) * speed - 20,
        life: 0.2 + Math.random() * 0.2,
        size: i % 3 === 0 ? 3 : 2,
        color: colors[i % colors.length]
      });
    }
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 230 * dt;
      p.vx *= Math.pow(0.2, dt);
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  finish(winner, reason) {
    this.phase = "ended";
    this.winner = winner;
    this.endReason = reason;
    for (const fighter of this.fighters) {
      fighter.attackTimer = 0;
      fighter.guarding = false;
      fighter.vx = 0;
    }
  }
}

class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.stars = Array.from({ length: 45 }, (_, i) => ({
      x: (i * 83 + 29) % WIDTH,
      y: 48 + ((i * 37 + 11) % 101),
      bright: i % 4 === 0
    }));
    this.buildings = Array.from({ length: 19 }, (_, i) => ({
      x: i * 28 - 10,
      w: 19 + (i * 7) % 15,
      h: 25 + (i * 17) % 58
    }));
  }

  draw(game) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.drawBackground(game.clock);

    ctx.save();
    if (game.shake > 0) {
      ctx.translate(
        Math.round((Math.random() * 2 - 1) * game.shake),
        Math.round((Math.random() * 2 - 1) * game.shake)
      );
    }
    this.drawShadow(game.fighters[0]);
    this.drawShadow(game.fighters[1]);
    this.drawFighter(game.fighters[0], game.clock);
    this.drawFighter(game.fighters[1], game.clock);
    this.drawParticles(game.particles);
    ctx.restore();

    this.drawHud(game);
    if (game.phase === "title") this.drawTitle(game.clock);
    if (game.phase === "ended") this.drawResult(game);
  }

  drawBackground(time) {
    const ctx = this.ctx;
    ctx.fillStyle = "#070b18";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#0c1225";
    ctx.fillRect(0, 92, WIDTH, 130);
    ctx.fillStyle = "#111a30";
    ctx.fillRect(0, 151, WIDTH, 71);

    for (const star of this.stars) {
      const twinkle = Math.floor(time * 2 + star.x) % 5 === 0;
      ctx.fillStyle = star.bright && twinkle ? "#d5e8dc" : "#3d4e69";
      ctx.fillRect(star.x, star.y, star.bright ? 2 : 1, star.bright ? 2 : 1);
    }

    ctx.fillStyle = "#b8c8c2";
    ctx.fillRect(384, 60, 25, 25);
    ctx.fillStyle = "#8d9f9f";
    ctx.fillRect(380, 64, 33, 17);
    ctx.fillRect(384, 56, 17, 33);
    ctx.fillStyle = "#0c1225";
    ctx.fillRect(391, 60, 9, 4);
    ctx.fillRect(400, 72, 7, 5);
    ctx.fillRect(385, 78, 5, 4);

    ctx.fillStyle = "#141d31";
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const y = GROUND_Y - b.h - 18;
      ctx.fillRect(b.x, y, b.w, b.h + 18);
      if (i % 3 === 0) ctx.fillRect(b.x + 5, y - 7, 3, 7);
      ctx.fillStyle = "#26334a";
      for (let wy = y + 7; wy < GROUND_Y - 9; wy += 10) {
        for (let wx = b.x + 4; wx < b.x + b.w - 3; wx += 8) {
          if ((wx + wy + i) % 4 === 0) ctx.fillRect(wx, wy, 2, 3);
        }
      }
      ctx.fillStyle = "#141d31";
    }

    ctx.fillStyle = "#0a101d";
    ctx.fillRect(0, 196, WIDTH, 26);
    for (let x = 8; x < WIDTH; x += 43) {
      ctx.fillRect(x, 177 + (x % 3) * 4, 18, 45);
      ctx.fillStyle = "#354159";
      ctx.fillRect(x + 4, 184 + (x % 3) * 4, 3, 4);
      ctx.fillStyle = "#0a101d";
    }

    ctx.fillStyle = "#253046";
    ctx.fillRect(0, GROUND_Y - 3, WIDTH, 3);
    ctx.fillStyle = "#4c5c70";
    ctx.fillRect(0, GROUND_Y - 3, WIDTH, 1);
    ctx.fillStyle = "#151d2d";
    ctx.fillRect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y);
    ctx.fillStyle = "#222d40";
    for (let x = -20; x < WIDTH + 20; x += 40) {
      ctx.fillRect(x, GROUND_Y + 5, 28, 2);
      ctx.fillRect(x + 7, GROUND_Y + 20, 32, 2);
      ctx.fillRect(x + 18, GROUND_Y + 7, 2, 13);
    }
    ctx.fillStyle = "#0a0f1b";
    ctx.fillRect(0, 253, WIDTH, 17);
    ctx.fillStyle = "#344258";
    for (let x = 10; x < WIDTH; x += 32) ctx.fillRect(x, 260, 12, 2);
  }

  drawHud(game) {
    const ctx = this.ctx;
    const [a, b] = game.fighters;
    ctx.fillStyle = "#070b14ee";
    ctx.fillRect(0, 0, WIDTH, 43);
    ctx.fillStyle = "#26324a";
    ctx.fillRect(0, 42, WIDTH, 1);

    this.drawHealth(a, 17, 18, false);
    this.drawHealth(b, 291, 18, true);

    ctx.textAlign = "center";
    ctx.fillStyle = "#6f7d96";
    ctx.font = "bold 7px monospace";
    ctx.fillText("ROUND 01", 240, 10);
    ctx.fillStyle = game.timeLeft <= 10 && game.phase === "playing" ? "#ff6b45" : "#e8f0df";
    ctx.font = "bold 22px monospace";
    ctx.fillText(String(Math.ceil(game.timeLeft)).padStart(2, "0"), 240, 32);
    ctx.textAlign = "left";

    ctx.fillStyle = "#617089";
    ctx.font = "7px monospace";
    ctx.fillText("STEEL CORE // ARENA_07", 17, 265);
    ctx.textAlign = "right";
    ctx.fillText(game.phase === "playing" ? "COMBAT ACTIVE" : "SYSTEM READY", 463, 265);
    ctx.textAlign = "left";
  }

  drawHealth(fighter, x, y, reverse) {
    const ctx = this.ctx;
    const width = 172;
    ctx.textAlign = reverse ? "right" : "left";
    ctx.fillStyle = fighter.palette.glow;
    ctx.font = "bold 8px 'Microsoft YaHei', monospace";
    ctx.fillText(`P${fighter.id + 1}  ${fighter.name}`, reverse ? x + width : x, 10);
    ctx.fillStyle = "#2b3549";
    ctx.fillRect(x, y, width, 12);
    ctx.fillStyle = "#090d17";
    ctx.fillRect(x + 2, y + 2, width - 4, 8);

    const innerWidth = Math.round((width - 4) * fighter.hp / 100);
    const fillX = reverse ? x + width - 2 - innerWidth : x + 2;
    ctx.fillStyle = fighter.hp <= 25 ? "#ff4b4b" : fighter.palette.main;
    ctx.fillRect(fillX, y + 2, innerWidth, 8);
    ctx.fillStyle = fighter.palette.light;
    if (innerWidth > 0) ctx.fillRect(fillX, y + 2, innerWidth, 2);

    const chargeWidth = Math.round(36 * (1 - fighter.cooldown / ATTACK_COOLDOWN));
    ctx.fillStyle = "#263249";
    ctx.fillRect(reverse ? x + width - 36 : x, 33, 36, 3);
    ctx.fillStyle = fighter.cooldown <= 0 ? fighter.palette.accent : "#59647a";
    ctx.fillRect(reverse ? x + width - chargeWidth : x, 33, chargeWidth, 3);
    ctx.fillStyle = "#d9e4df";
    ctx.font = "bold 7px monospace";
    ctx.fillText(String(fighter.hp).padStart(3, "0"), reverse ? x + 28 : x + width, 37);
    ctx.textAlign = "left";
  }

  drawShadow(fighter) {
    const ctx = this.ctx;
    const width = fighter.grounded ? 24 : 16;
    ctx.fillStyle = "#03060a99";
    ctx.fillRect(Math.round(fighter.centerX - width / 2), GROUND_Y, width, 3);
    ctx.fillRect(Math.round(fighter.centerX - width / 2 + 3), GROUND_Y - 1, width - 6, 1);
  }

  drawFighter(fighter, time) {
    const ctx = this.ctx;
    const state = fighter.animationState();
    if (state === "dead") {
      this.drawDestroyed(fighter);
      return;
    }

    const idleBob = state === "idle" ? Math.floor(time * 2.5 + fighter.id) % 2 : 0;
    const recoil = state === "hurt" ? -fighter.facing * 2 : 0;
    ctx.save();
    ctx.translate(Math.round(fighter.x + recoil), Math.round(fighter.y + idleBob));
    if (fighter.facing < 0) {
      ctx.translate(fighter.w, 0);
      ctx.scale(-1, 1);
    }

    const p = { ...fighter.palette };
    if (fighter.hitFlash > 0 && Math.floor(fighter.hitFlash * 60) % 2 === 0) {
      p.main = "#f4f7e9";
      p.light = "#ffffff";
      p.dark = "#a8bbc1";
    }

    let frontLeg = 0;
    let backLeg = 0;
    let legHeight = 9;
    if (state === "run") {
      const frame = Math.floor(time * 12) % 4;
      frontLeg = [2, 0, -2, 0][frame];
      backLeg = -frontLeg;
    } else if (state === "jump") {
      frontLeg = 2;
      backLeg = -1;
      legHeight = 7;
    }

    this.drawLeg(3 + backLeg, 21, legHeight, p.dark, p.main);
    this.drawLeg(13 + frontLeg, 21, legHeight, p.dark, p.light);

    ctx.fillStyle = "#080e19";
    ctx.fillRect(2, 12, 6, 11);
    ctx.fillStyle = p.dark;
    ctx.fillRect(3, 13, 4, 8);
    ctx.fillStyle = p.main;
    ctx.fillRect(1, 11, 7, 5);

    ctx.fillStyle = "#080e19";
    ctx.fillRect(4, 10, 15, 13);
    ctx.fillStyle = p.dark;
    ctx.fillRect(5, 11, 13, 11);
    ctx.fillStyle = p.main;
    ctx.fillRect(7, 11, 10, 8);
    ctx.fillStyle = p.light;
    ctx.fillRect(7, 12, 3, 5);
    ctx.fillStyle = "#09121e";
    ctx.fillRect(11, 14, 5, 5);
    ctx.fillStyle = p.accent;
    ctx.fillRect(12, 15, 3, 3);
    ctx.fillStyle = p.dark;
    ctx.fillRect(7, 21, 10, 3);

    ctx.fillStyle = "#080e19";
    ctx.fillRect(6, 2, 12, 10);
    ctx.fillStyle = p.main;
    ctx.fillRect(7, 3, 10, 7);
    ctx.fillStyle = p.light;
    ctx.fillRect(8, 3, 7, 2);
    ctx.fillStyle = "#09121e";
    ctx.fillRect(10, 6, 9, 4);
    ctx.fillStyle = p.accent;
    ctx.fillRect(12, 7, 5, 2);
    ctx.fillStyle = p.dark;
    ctx.fillRect(6, 9, 4, 3);
    ctx.fillRect(7, 0, 2, 4);
    ctx.fillStyle = p.light;
    ctx.fillRect(7, 0, 2, 2);

    if (state === "guard") {
      this.drawGuardArm(p);
    } else if (state === "attack") {
      this.drawAttackArm(fighter, p);
    } else {
      const armY = state === "jump" ? 9 : 12;
      ctx.fillStyle = "#080e19";
      ctx.fillRect(16, armY, 6, 11);
      ctx.fillStyle = p.main;
      ctx.fillRect(17, armY + 1, 4, 8);
      ctx.fillStyle = p.light;
      ctx.fillRect(17, armY + 8, 6, 4);
    }
    ctx.restore();
  }

  drawLeg(x, y, height, dark, light) {
    const ctx = this.ctx;
    ctx.fillStyle = "#080e19";
    ctx.fillRect(x, y, 7, height + 3);
    ctx.fillStyle = dark;
    ctx.fillRect(x + 1, y, 5, height);
    ctx.fillStyle = light;
    ctx.fillRect(x + 2, y + 1, 3, 3);
    ctx.fillStyle = "#080e19";
    ctx.fillRect(x - 1, y + height, 9, 4);
    ctx.fillStyle = dark;
    ctx.fillRect(x, y + height, 8, 2);
  }

  drawGuardArm(p) {
    const ctx = this.ctx;
    ctx.fillStyle = "#080e19";
    ctx.fillRect(15, 12, 8, 10);
    ctx.fillStyle = p.main;
    ctx.fillRect(16, 13, 6, 8);
    ctx.fillStyle = p.light;
    ctx.fillRect(19, 14, 5, 5);
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = p.glow;
    ctx.fillRect(24, 6, 3, 23);
    ctx.fillRect(27, 9, 2, 17);
    ctx.fillRect(22, 9, 2, 3);
    ctx.fillRect(22, 24, 2, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#d9ffff";
    ctx.fillRect(24, 8, 1, 18);
  }

  drawAttackArm(fighter, p) {
    const ctx = this.ctx;
    const t = fighter.attackElapsed;
    if (t < 0.1) {
      ctx.fillStyle = "#080e19";
      ctx.fillRect(13, 7, 7, 10);
      ctx.fillStyle = p.main;
      ctx.fillRect(14, 8, 5, 8);
      ctx.fillStyle = p.light;
      ctx.fillRect(16, 5, 4, 5);
      ctx.fillStyle = "#f7f4cc";
      ctx.fillRect(18, 1, 3, 8);
      ctx.fillStyle = p.glow;
      ctx.fillRect(21, 0, 3, 7);
    } else if (t <= 0.2) {
      ctx.fillStyle = "#080e19";
      ctx.fillRect(16, 12, 11, 7);
      ctx.fillStyle = p.main;
      ctx.fillRect(17, 13, 9, 5);
      ctx.fillStyle = p.light;
      ctx.fillRect(23, 12, 5, 6);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.glow;
      ctx.fillRect(24, 5, 4, 5);
      ctx.fillRect(28, 8, 5, 4);
      ctx.fillRect(32, 11, 8, 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.glow;
      ctx.fillRect(26, 13, 15, 4);
      ctx.fillStyle = "#f5ffe9";
      ctx.fillRect(27, 13, 14, 2);
      ctx.fillRect(39, 14, 3, 2);
    } else {
      ctx.fillStyle = "#080e19";
      ctx.fillRect(16, 16, 10, 7);
      ctx.fillStyle = p.main;
      ctx.fillRect(17, 17, 8, 5);
      ctx.fillStyle = p.light;
      ctx.fillRect(23, 18, 5, 5);
      ctx.fillStyle = p.glow;
      ctx.fillRect(26, 20, 4, 7);
      ctx.fillRect(29, 25, 4, 5);
      ctx.fillStyle = "#f5ffe9";
      ctx.fillRect(27, 20, 2, 7);
    }
  }

  drawDestroyed(fighter) {
    const ctx = this.ctx;
    const x = Math.round(fighter.x - 4);
    const y = GROUND_Y - 10;
    const p = fighter.palette;
    ctx.fillStyle = "#080e19";
    ctx.fillRect(x + 2, y + 2, 30, 8);
    ctx.fillStyle = p.dark;
    ctx.fillRect(x + 5, y + 2, 18, 6);
    ctx.fillStyle = p.main;
    ctx.fillRect(x + 9, y, 12, 5);
    ctx.fillStyle = "#101722";
    ctx.fillRect(x + 13, y + 2, 5, 4);
    ctx.fillStyle = p.light;
    ctx.fillRect(x + 25, y + 4, 7, 4);
    ctx.fillStyle = "#080e19";
    ctx.fillRect(x + 28, y + 1, 7, 7);
    ctx.fillStyle = p.main;
    ctx.fillRect(x + 29, y + 2, 5, 4);
    ctx.fillStyle = "#526074";
    ctx.fillRect(x, y + 8, 8, 2);
  }

  drawParticles(particles) {
    const ctx = this.ctx;
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
  }

  panel(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = "#070b16ed";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#3a4962";
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
    ctx.fillStyle = "#39d9d0";
    ctx.fillRect(x - 3, y - 3, 13, 2);
    ctx.fillRect(x - 3, y - 3, 2, 13);
    ctx.fillStyle = "#ff6b45";
    ctx.fillRect(x + w - 10, y + h + 1, 13, 2);
    ctx.fillRect(x + w + 1, y + h - 10, 2, 13);
  }

  drawTitle(time) {
    const ctx = this.ctx;
    ctx.fillStyle = "#03050a99";
    ctx.fillRect(0, 43, WIDTH, HEIGHT - 43);
    this.panel(89, 66, 302, 141);
    ctx.textAlign = "center";
    ctx.fillStyle = "#39d9d0";
    ctx.font = "bold 8px monospace";
    ctx.fillText("P I X E L   M E C H A   C O M B A T", 240, 86);
    ctx.fillStyle = "#eef5e9";
    ctx.font = "900 29px 'Microsoft YaHei', sans-serif";
    ctx.fillText("钢 核 对 决", 240, 122);
    ctx.fillStyle = "#ff6b45";
    ctx.fillRect(173, 133, 134, 3);
    ctx.fillStyle = "#8290a8";
    ctx.font = "8px 'Microsoft YaHei', monospace";
    ctx.fillText("一台键盘 · 两名驾驶员 · 唯有胜者离场", 240, 153);
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = "#ffe073";
      ctx.font = "bold 11px 'Microsoft YaHei', monospace";
      ctx.fillText("按 ENTER 投入战斗", 240, 182);
    }
    ctx.fillStyle = "#526079";
    ctx.font = "7px monospace";
    ctx.fillText("MOVE / JUMP / BLADE / GUARD", 240, 197);
    ctx.textAlign = "left";
  }

  drawResult(game) {
    const ctx = this.ctx;
    ctx.fillStyle = "#03050a88";
    ctx.fillRect(0, 43, WIDTH, HEIGHT - 43);
    this.panel(104, 72, 272, 130);
    ctx.textAlign = "center";
    ctx.fillStyle = game.endReason === "ko" ? "#ff6b45" : "#ffe073";
    ctx.font = "900 25px monospace";
    ctx.fillText(game.endReason === "ko" ? "K.O." : "TIME UP", 240, 105);
    ctx.fillStyle = "#edf5e9";
    ctx.font = "900 17px 'Microsoft YaHei', sans-serif";
    ctx.fillText(game.winner ? `${game.winner.name} 获胜` : "双双击毁 · 平局", 240, 136);
    ctx.fillStyle = "#7e8ca3";
    ctx.font = "8px 'Microsoft YaHei', monospace";
    const [a, b] = game.fighters;
    ctx.fillText(`P1  ${String(a.hp).padStart(3, "0")} HP     /     P2  ${String(b.hp).padStart(3, "0")} HP`, 240, 157);
    if (Math.floor(game.clock * 2) % 2 === 0) {
      ctx.fillStyle = "#39d9d0";
      ctx.font = "bold 10px 'Microsoft YaHei', monospace";
      ctx.fillText("按 ENTER 再来一局", 240, 184);
    }
    ctx.textAlign = "left";
  }
}

function fitCanvas() {
  const canvas = document.getElementById("game");
  const screen = document.getElementById("screen");
  const available = screen.clientWidth;
  const scale = available >= WIDTH ? Math.max(1, Math.floor(available / WIDTH)) : available / WIDTH;
  canvas.style.width = `${Math.floor(WIDTH * scale)}px`;
}

window.addEventListener("resize", fitCanvas);
fitCanvas();
window.steelCoreGame = new Game(document.getElementById("game"));
