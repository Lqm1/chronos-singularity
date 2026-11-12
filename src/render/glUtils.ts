export interface RenderTarget {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  width: number;
  height: number;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create WebGL shader object.');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSource: string,
  fragSource: string
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error('Failed to create WebGL program.');
  }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }
  return program;
}

export interface TextureSpec {
  internalFormat: number;
  format: number;
  type: number;
  filter: number;
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  specs: TextureSpec[]
): RenderTarget {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    throw new Error('Failed to create WebGL framebuffer.');
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  const textures: WebGLTexture[] = [];
  const attachments: number[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const tex = gl.createTexture();
    if (!tex) {
      throw new Error('Failed to create WebGL texture.');
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      spec.internalFormat,
      w,
      h,
      0,
      spec.format,
      spec.type,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, spec.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, spec.filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const attachment = gl.COLOR_ATTACHMENT0 + i;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, tex, 0);
    textures.push(tex);
    attachments.push(attachment);
  }

  gl.drawBuffers(attachments);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    for (const tex of textures) gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
    throw new Error(`Incomplete framebuffer status: 0x${status.toString(16)}`);
  }

  return { fbo, textures, width: w, height: h };
}

export function destroyRenderTarget(gl: WebGL2RenderingContext, rt: RenderTarget | null): void {
  if (!rt) return;
  for (const tex of rt.textures) {
    gl.deleteTexture(tex);
  }
  gl.deleteFramebuffer(rt.fbo);
}

export function getUniformLocations<T extends readonly string[]>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: T
): Record<T[number], WebGLUniformLocation | null> {
  const map = {} as Record<T[number], WebGLUniformLocation | null>;
  for (const name of names) {
    map[name as T[number]] = gl.getUniformLocation(program, name);
  }
  return map;
}
