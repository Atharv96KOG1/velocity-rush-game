// Final screen-space pass: speed blur, chromatic aberration, vignette, photo filters, rewind tint.
export const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null },
    speed: { value: 0 },
    vignette: { value: 0.35 },
    look: { value: 0 },        // 0 none, 1 noir, 2 vivid, 3 retro
    rewind: { value: 0 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float speed, vignette, rewind, time;
    uniform int look;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d);
      // Zoom blur toward the centre, strongest at the edges and at high speed.
      float blur = speed * speed * 0.07;
      vec3 col = vec3(0.0);
      for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, vUv - d * blur * float(i) / 7.0).rgb;
      col /= 8.0;
      // Chromatic aberration grows toward the edges.
      float ca = (0.002 + speed * 0.008) * r;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + d * ca * 2.0).r, 0.85);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - d * ca * 2.0).b, 0.85);

      float l = dot(col, vec3(0.299, 0.587, 0.114));
      if (look == 1) col = vec3(pow(l, 1.15)) * vec3(1.04, 1.0, 0.96);
      else if (look == 2) col = max(mix(vec3(l), col, 1.5), 0.0);
      else if (look == 3) col = vec3(col.r * 1.08 + 0.04, col.g * 0.96 + 0.02, col.b * 0.78) * (0.94 + 0.06 * sin(vUv.y * 900.0));
      if (rewind > 0.5) col = mix(vec3(l) * vec3(0.65, 0.85, 1.2), col, 0.2) + 0.03 * sin(vUv.y * 300.0 + time * 30.0);

      col *= 1.0 - smoothstep(0.42, 0.95, r) * vignette;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
