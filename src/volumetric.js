import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { globalUniforms } from './shared.js';

// 水中のボリューメトリックライト（光の柱）
// 視線に沿って水中を進み、各点へ水面から差し込む光の量を積算する。
// 光の量は「その点に届く光が水面のどこから入ったか」で決まり、水面の波で揺れる模様になる。
// シーンの深度を使うので、手前の物体より奥の光は隠れる。
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class VolumetricLightPass extends Pass {
  constructor(camera, { steps = 32, scale = 0.5 } = {}) {
    super();
    this.camera = camera;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.intensity = 1;
    this.color = new THREE.Color(1, 1, 1);
    this.lightDir = new THREE.Vector3(0.3, -1, -0.1).normalize();

    this.march = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uLight: { value: this.lightDir },
        uSurfaceY: globalUniforms.uSurfaceY,
        uTime: globalUniforms.uTime,
        uMaxDist: { value: 24 },
        uBeamScale: { value: 0.75 },
        uCoverage: { value: 0.5 },
        uSharp: { value: 0.17 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform mat4 uInvProj, uCamWorld;
        uniform vec3 uCamPos, uLight;
        uniform float uSurfaceY, uTime, uMaxDist, uBeamScale, uCoverage, uSharp;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        // 水面で光が集まる場所（波がレンズになってできる光の束）
        float beam(vec2 e) {
          float t = uTime;
          vec2 q = e * uBeamScale;
          float n = vnoise(q + vec2(t * 0.045, t * 0.02)) * 0.6
                  + vnoise(q * 2.3 + vec2(-t * 0.07, t * 0.05)) * 0.3
                  + vnoise(q * 5.1 + vec2(t * 0.11, -t * 0.09)) * 0.1;
          float fine = pow(smoothstep(1.0 - uCoverage, 1.0 - uCoverage + uSharp, n), 2.0);
          float broad = vnoise(e * uBeamScale * 0.35 + vec2(t * 0.02, -t * 0.015));
          broad = smoothstep(0.35, 0.85, broad);
          return fine * (0.3 + 0.7 * broad) + broad * 0.04;
        }
        void main() {
          float z = texture2D(tDepth, vUv).x;
          vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          vp /= vp.w;
          vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
          vec3 rd = wp - uCamPos;
          float L = min(length(rd), uMaxDist);
          rd = normalize(rd);
          const int STEPS = ${steps};
          float stepLen = L / float(STEPS);
          // ピクセルごとに開始位置をずらして段差を消す（毎フレームは変えない＝ちらつかない）
          float jitter = hash(gl_FragCoord.xy * 0.37);
          float acc = 0.0;
          vec2 lxz = uLight.xz / -uLight.y;
          for (int i = 0; i < STEPS; i++) {
            float d = (float(i) + jitter) * stepLen;
            vec3 p = uCamPos + rd * d;
            float depth = uSurfaceY - p.y;
            if (depth < 0.0) continue;
            vec2 e = p.xz - lxz * depth;
            float b = beam(e);
            // 深いほど拡散して弱まる、水面直下は特に明るい
            float att = exp(-depth * 0.085) * (1.0 + exp(-depth * 1.0) * 0.6);
            acc += b * att * stepLen;
          }
          // 光源方向を向くほど明るい（前方散乱）
          float g = 0.45;
          float cosT = dot(rd, -uLight);
          float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.35 + 0.25;
          gl_FragColor = vec4(vec3(acc * phase), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });

    this.comp = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tVol: { value: null }, uColor: { value: this.color }, uIntensity: { value: 1 }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tVol;
        uniform vec3 uColor;
        uniform float uIntensity;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          // 低解像度の結果をやわらかく拡大
          vec2 o = uTexel * 1.2;
          float v = texture2D(tVol, vUv).r * 0.28
                  + (texture2D(tVol, vUv + vec2(o.x, 0.0)).r + texture2D(tVol, vUv - vec2(o.x, 0.0)).r
                  + texture2D(tVol, vUv + vec2(0.0, o.y)).r + texture2D(tVol, vUv - vec2(0.0, o.y)).r) * 0.12
                  + (texture2D(tVol, vUv + o).r + texture2D(tVol, vUv - o).r
                  + texture2D(tVol, vUv + vec2(o.x, -o.y)).r + texture2D(tVol, vUv + vec2(-o.x, o.y)).r) * 0.06;
          gl_FragColor = vec4(c + uColor * v * uIntensity, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.fsq = new FullScreenQuad(this.march);
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.floor(w * this.scale)), Math.max(1, Math.floor(h * this.scale)));
    this.comp.uniforms.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    const u = this.march.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    this.fsq.material = this.march;
    renderer.setRenderTarget(this.rt);
    this.fsq.render(renderer);

    this.comp.uniforms.tDiffuse.value = readBuffer.texture;
    this.comp.uniforms.tVol.value = this.rt.texture;
    this.comp.uniforms.uIntensity.value = this.intensity;
    this.fsq.material = this.comp;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }

  dispose() {
    this.rt.dispose();
    this.fsq.dispose();
  }
}
