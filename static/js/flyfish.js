/**
 * 源码来自互联网，作者不详
 * @modified by Lruihao 2024-05-21 移除依赖 jQuery
 * @adapted for PaperMod theme (no FixIt globals / no JS build pipeline)
 * @description 一个鱼游动的动画效果
 * @see https://github.com/hugo-fixit/cmpt-flyfish
 */
const LIGHT_FILL = 'rgb(0 119 190 / 10%)';
const DARK_FILL = 'rgb(255 255 255 / 10%)';

const RENDERER = {
  POINT_INTERVAL: 5,
  FISH_COUNT: 3,
  MAX_INTERVAL_COUNT: 50,
  INIT_HEIGHT_RATE: 0.5,
  // Roughly (fish nose reach in local coordinates) * (current draw scale) --
  // keep this in step with FISH.prototype.render's scale factor, or the
  // ripple's x-offset and detection band drift out of proportion with the
  // fish's actual visual size.
  THRESHOLD: 40,

  init: function () {
    this.setParameters();
    this.setStyle();
    this.reconstructMethods();
    this.setup();
    this.bindEvent();
    this.render();
  },
  setParameters: function () {
    this.window = window;
    this.container = document.createElement("div");
    this.container.id = "flyfish";
    this.canvas = document.createElement("canvas");
    this.context = this.canvas.getContext("2d");
    this.points = [];
    this.fishes = [];
    this.watchIds = [];
    document.querySelector('.footer').appendChild(this.container);
  },
  setStyle: function () {
    const style = document.createElement("style");
    style.innerHTML = `
    .footer {
      position: relative;
    }
    #flyfish {
      position: absolute;
      width: 100vw;
      left: 50%;
      transform: translateX(-50%);
      height: 230px;
      overflow: hidden;
      bottom: 0;
      z-index: -1;
      pointer-events: none;
    }`;
    document.querySelector("head").appendChild(style);
  },
  createSurfacePoints: function () {
    const count = Math.round(this.width / this.POINT_INTERVAL);
    this.pointInterval = this.width / (count - 1);
    this.points.push(new SURFACE_POINT(this, 0));

    for (let i = 1; i < count; i++) {
      const point = new SURFACE_POINT(this, i * this.pointInterval),
        previous = this.points[i - 1];

      point.setPreviousPoint(previous);
      previous.setNextPoint(point);
      this.points.push(point);
    }
  },
  reconstructMethods: function () {
    this.watchWindowSize = this.watchWindowSize.bind(this);
    this.jdugeToStopResize = this.jdugeToStopResize.bind(this);
    this.startEpicenter = this.startEpicenter.bind(this);
    this.moveEpicenter = this.moveEpicenter.bind(this);
    this.render = this.render.bind(this);
  },
  setup: function () {
    this.points.length = 0;
    this.fishes.length = 0;
    this.watchIds.length = 0;
    this.intervalCount = this.MAX_INTERVAL_COUNT;

    this.containerWidth = this.container.offsetWidth;
    this.containerHeight = this.container.offsetHeight;
    this.width = this.containerWidth;
    this.height = this.containerHeight;
    this.fishCount =
      (((this.FISH_COUNT * this.width) / 500) * this.height) / 500;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.reverse = false;

    this.container.appendChild(this.canvas);
    this.fishes.push(new FISH(this));
    this.createSurfacePoints();
  },
  watchWindowSize: function () {
    this.clearTimer();
    this.tmpWidth = this.window.innerWidth;
    this.tmpHeight = this.window.innerHeight;
    this.watchIds.push(setTimeout(this.jdugeToStopResize, this.WATCH_INTERVAL));
  },
  clearTimer: function () {
    while (this.watchIds.length > 0) {
      clearTimeout(this.watchIds.pop());
    }
  },
  jdugeToStopResize: function () {
    const width = this.window.innerWidth,
      height = this.window.innerHeight,
      stopped = width == this.tmpWidth && height == this.tmpHeight;

    this.tmpWidth = width;
    this.tmpHeight = height;

    if (stopped) {
      this.setup();
    }
  },
  bindEvent: function () {
    const self = this;
    this.window.addEventListener("resize", function() {
      self.watchWindowSize();
    });
    this.container.addEventListener("mouseenter", function(event) {
      self.startEpicenter(event);
    });
    this.container.addEventListener("mousemove", function(event) {
      self.moveEpicenter(event);
    });
  },
  getAxis: function (event) {
    const offset = this.container.getBoundingClientRect();

    return {
      x: event.clientX - offset.left + this.window.scrollX,
      y: event.clientY - offset.top + this.window.scrollY,
    };
  },
  startEpicenter: function (event) {
    this.axis = this.getAxis(event);
  },
  moveEpicenter: function (event) {
    const axis = this.getAxis(event);

    if (!this.axis) {
      this.axis = axis;
    }
    this.generateEpicenter(axis.x, axis.y, axis.y - this.axis.y);
    this.axis = axis;
  },
  generateEpicenter: function (x, y, velocity) {
    if (
      y < this.height / 2 - this.THRESHOLD ||
      y > this.height / 2 + this.THRESHOLD
    ) {
      return;
    }
    const index = Math.round(x / this.pointInterval);

    if (index < 0 || index >= this.points.length) {
      return;
    }
    this.points[index].interfere(y, velocity);
  },
  controlStatus: function () {
    for (let i = 0, count = this.points.length; i < count; i++) {
      this.points[i].updateSelf();
    }
    for (let i = 0, count = this.points.length; i < count; i++) {
      this.points[i].updateNeighbors();
    }
    if (this.fishes.length < this.fishCount) {
      if (--this.intervalCount == 0) {
        this.intervalCount = this.MAX_INTERVAL_COUNT;
        this.fishes.push(new FISH(this));
      }
    }
  },
  render: function () {
    const self = this;
    function renderFrame() {
      self.controlStatus();
      self.context.clearRect(0, 0, self.width, self.height);
      if (document.documentElement.dataset.theme === "dark") {
        self.context.fillStyle = DARK_FILL;
      } else {
        self.context.fillStyle = LIGHT_FILL;
      }

      for (let i = 0, count = self.fishes.length; i < count; i++) {
        self.fishes[i].render(self.context);
      }
      self.context.save();
      self.context.globalCompositeOperation = "xor";
      self.context.beginPath();
      self.context.moveTo(0, self.reverse ? 0 : self.height);

      for (let i = 0, count = self.points.length; i < count; i++) {
        self.points[i].render(self.context);
      }
      self.context.lineTo(self.width, self.reverse ? 0 : self.height);
      self.context.closePath();
      self.context.fill();
      self.context.restore();

      requestAnimationFrame(renderFrame);
    }
    renderFrame();
  },
};

// SURFACE_POINT class
function SURFACE_POINT(renderer, x) {
  this.renderer = renderer;
  this.x = x;
  this.init();
}
SURFACE_POINT.prototype = {
  SPRING_CONSTANT: 0.03,
  SPRING_FRICTION: 0.9,
  WAVE_SPREAD: 0.3,
  ACCELARATION_RATE: 0.01,

  init: function () {
    this.initHeight = this.renderer.height * this.renderer.INIT_HEIGHT_RATE;
    this.height = this.initHeight;
    this.fy = 0;
    this.force = { previous: 0, next: 0 };
  },
  setPreviousPoint: function (previous) {
    this.previous = previous;
  },
  setNextPoint: function (next) {
    this.next = next;
  },
  interfere: function (y, velocity) {
    this.fy =
      this.renderer.height *
      this.ACCELARATION_RATE *
      (this.renderer.height - this.height - y >= 0 ? -1 : 1) *
      Math.abs(velocity);
  },
  updateSelf: function () {
    this.fy += this.SPRING_CONSTANT * (this.initHeight - this.height);
    this.fy *= this.SPRING_FRICTION;
    this.height += this.fy;
  },
  updateNeighbors: function () {
    if (this.previous) {
      this.force.previous =
        this.WAVE_SPREAD * (this.height - this.previous.height);
    }
    if (this.next) {
      this.force.next = this.WAVE_SPREAD * (this.height - this.next.height);
    }
  },
  render: function (context) {
    if (this.previous) {
      this.previous.height += this.force.previous;
      this.previous.fy += this.force.previous;
    }
    if (this.next) {
      this.next.height += this.force.next;
      this.next.fy += this.force.next;
    }
    context.lineTo(this.x, this.renderer.height - this.height);
  },
};

// FISH class
function FISH(renderer) {
  this.renderer = renderer;
  this.init();
}
FISH.prototype = {
  // Lower than a "realistic" 0.4 -- a weaker gravity while airborne makes
  // the leap hang longer and, since horizontal speed doesn't change during
  // the jump, also covers more horizontal distance for the same launch.
  // Both airtime and peak height scale as 1/GRAVITY for a fixed launch
  // speed, so this value is tuned to put both at ~75% of the 0.15 baseline.
  GRAVITY: 0.2,
  // Caps how fast a fish can be moving vertically at any point. Without
  // this, the underwater acceleration phase (see `ay` below) has no upper
  // bound -- it keeps speeding the fish up every frame until it happens to
  // cross the waterline, so breach speed (and therefore jump height) was
  // effectively unbounded and could randomly exceed the visible container.
  // Peak height above the waterline is speed^2 / (2 * GRAVITY), so this
  // caps jumps at roughly 22px -- comfortably inside the container.
  MAX_SPEED: 3,

  init: function () {
    this.direction = Math.random() < 0.5;
    this.x = this.direction
      ? this.renderer.width + this.renderer.THRESHOLD
      : -this.renderer.THRESHOLD;
    this.previousY = this.y;
    this.vx = this.getRandomValue(4, 10) * (this.direction ? -1 : 1);

    if (this.renderer.reverse) {
      this.y = this.getRandomValue(
        (this.renderer.height * 1) / 10,
        (this.renderer.height * 4) / 10
      );
      this.vy = this.getRandomValue(2, 5);
      this.ay = this.getRandomValue(0.05, 0.2);
    } else {
      this.y = this.getRandomValue(
        (this.renderer.height * 6) / 10,
        (this.renderer.height * 9) / 10
      );
      this.vy = this.getRandomValue(-5, -2);
      this.ay = this.getRandomValue(-0.2, -0.05);
    }
    this.isOut = false;
    this.theta = 0;
    this.phi = 0;
  },
  getRandomValue: function (min, max) {
    return min + (max - min) * Math.random();
  },
  controlStatus: function (context) {
    this.previousY = this.y;
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.ay;
    this.vy = Math.max(-this.MAX_SPEED, Math.min(this.MAX_SPEED, this.vy));

    if (this.renderer.reverse) {
      if (this.y > this.renderer.height * this.renderer.INIT_HEIGHT_RATE) {
        this.vy -= this.GRAVITY;
        // Once airborne, only gravity should act -- leaving the old
        // underwater `ay` in place fought against gravity every frame
        // (they nearly canceled out), making jumps decelerate barely at
        // all and hang in the air far longer than intended.
        this.ay = 0;
        this.isOut = true;
      } else {
        if (this.isOut) {
          this.ay = this.getRandomValue(0.05, 0.2);
        }
        this.isOut = false;
      }
    } else {
      if (this.y < this.renderer.height * this.renderer.INIT_HEIGHT_RATE) {
        this.vy += this.GRAVITY;
        this.ay = 0;
        this.isOut = true;
      } else {
        if (this.isOut) {
          this.ay = this.getRandomValue(-0.2, -0.05);
        }
        this.isOut = false;
      }
    }
    if (!this.isOut) {
      this.theta += Math.PI / 20;
      this.theta %= Math.PI * 2;
      this.phi += Math.PI / 30;
      this.phi %= Math.PI * 2;
    }
    this.renderer.generateEpicenter(
      this.x + (this.direction ? -1 : 1) * this.renderer.THRESHOLD,
      this.y,
      this.y - this.previousY
    );

    if (
      (this.vx > 0 && this.x > this.renderer.width + this.renderer.THRESHOLD) ||
      (this.vx < 0 && this.x < -this.renderer.THRESHOLD)
    ) {
      this.init();
    }
  },
  render: function (context) {
    context.save();
    context.translate(this.x, this.y);
    context.rotate(Math.PI + Math.atan2(this.vy, this.vx));
    // Local -x leads (points along travel direction) under the rotate above,
    // so flip x here to put the nose (drawn at positive x) in front.
    context.scale(-0.6, this.direction ? 0.6 : -0.6);

    // Body + tail as ONE continuous path. The rear portion's points are
    // passed through bend() (a rotation about the hinge) so the whole rear
    // half flexes smoothly with the SAME fill -- there is no seam to hide,
    // because a point exactly at the hinge is invariant under its own
    // rotation, so the curve provably reconnects to the static front exactly.
    const hingeX = 6;
    const bendAngle =
      (Math.PI / 9) * Math.sin(this.phi) * (this.renderer.reverse ? -1 : 1);
    const cos = Math.cos(bendAngle);
    const sin = Math.sin(bendAngle);
    const bend = (x, y) => {
      const dx = x - hingeX;
      return [hingeX + dx * cos - y * sin, dx * sin + y * cos];
    };

    context.beginPath();
    // Head/shoulder, static: rounded snout (no barbel-like hook), gradual
    // taper matching the tail's own gradual taper for better proportion.
    context.moveTo(hingeX, 13);
    context.bezierCurveTo(20, 14, 38, 13, 50, 4);
    context.quadraticCurveTo(56, 0, 50, -4);
    context.bezierCurveTo(38, -13, 20, -14, hingeX, -13);
    // Rear body, flexing: tapers into the peduncle.
    let p1, p2, p3;
    p1 = bend(-8, -12);
    p2 = bend(-16, -8);
    p3 = bend(-22, -3);
    context.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    p1 = bend(-30, -10);
    p2 = bend(-40, -16);
    p3 = bend(-46, -20);
    context.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    // Wide, solid, shallowly forked tail (unlike a tuna's deep lunate fork).
    p1 = bend(-38, -8);
    p2 = bend(-34, -2);
    context.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
    p1 = bend(-38, 8);
    p2 = bend(-46, 20);
    context.quadraticCurveTo(p1[0], p1[1], p2[0], p2[1]);
    p1 = bend(-40, 16);
    p2 = bend(-30, 10);
    p3 = bend(-22, 3);
    context.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    p1 = bend(-16, 8);
    p2 = bend(-8, 12);
    p3 = bend(hingeX, 13);
    context.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    context.closePath();
    context.fill();

    // Dorsal fin: single, swept back, mid-back (static, doesn't flex).
    context.beginPath();
    context.moveTo(14, 13);
    context.quadraticCurveTo(19, 21, 26, 14);
    context.quadraticCurveTo(20, 13, 14, 13);
    context.fill();

    // Pelvic fins: paired, small, low on the belly, roughly mid-body.
    context.beginPath();
    context.moveTo(14, -13);
    context.quadraticCurveTo(18, -19, 22, -15);
    context.quadraticCurveTo(18, -14, 14, -13);
    context.fill();

    // Pectoral fins: paired, low on the sides, right behind the head.
    context.beginPath();
    context.moveTo(30, -10);
    context.quadraticCurveTo(35, -18, 40, -13);
    context.quadraticCurveTo(36, -11, 30, -10);
    context.fill();

    // Adipose fin: small soft bump unique to salmon/trout, sitting right on
    // the back edge between the dorsal fin and the tail -- flexes with the
    // rear body since its position is passed through bend() too.
    const adipose = bend(-30, 9);
    context.beginPath();
    context.arc(adipose[0], adipose[1], 2, 0, Math.PI * 2);
    context.fill();

    // Anal fin: single, small, swept back, belly side, behind the belly and
    // just before the tail -- also flexes with the rear body.
    const n1 = bend(-26, -6);
    const n2 = bend(-22, -14);
    const n3 = bend(-18, -9);
    const n4 = bend(-21, -8);
    context.beginPath();
    context.moveTo(n1[0], n1[1]);
    context.quadraticCurveTo(n2[0], n2[1], n3[0], n3[1]);
    context.quadraticCurveTo(n4[0], n4[1], n1[0], n1[1]);
    context.fill();

    context.restore();
    this.controlStatus(context);
  },
};

window.addEventListener("load", () => {
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    RENDERER.init();
  }
});
