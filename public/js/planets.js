// Procedural star systems. Planet surfaces are baked once on the GPU into equirectangular textures:
// colour (sRGB), data (R height for bump, G roughness, B emission mask) and clouds.
import * as THREE from 'three';
import { rng, pick, range } from './util.js';

const NOISE = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p,int o){float a=0.5,s=0.0;for(int i=0;i<8;i++){if(i>=o)break;s+=a*snoise(p);p=p*2.03+17.1;a*=0.5;}return s;}
float ridged(vec3 p,int o){float a=0.5,s=0.0;for(int i=0;i<8;i++){if(i>=o)break;float n=1.0-abs(snoise(p));s+=a*n*n;p=p*2.07+9.3;a*=0.5;}return s;}
vec3 hash3(vec3 p){p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));return fract(sin(p)*43758.5453123);}
float crater(vec3 p){
  vec3 i=floor(p),f=fract(p);float d=8.0,r=0.0;
  for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++)for(int z=-1;z<=1;z++){vec3 g=vec3(float(x),float(y),float(z));vec3 o=hash3(i+g);vec3 dv=g+o-f;float dd=dot(dv,dv);if(dd<d){d=dd;r=hash3(i+g+7.0).x;}}
  float rad=0.18+0.22*r,x=sqrt(d)/rad; if(x>1.8)return 0.0;
  return (x<1.0?(x*x-1.0)*0.55:0.0)+exp(-pow((x-1.0)*4.0,2.0))*0.3;
}`;

const BAKE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform int uType, uPass; uniform vec3 uOff; uniform float uSea, uFreq, uBand; uniform vec3 uP[6]; uniform vec3 uStorm;
${NOISE}
void main(){
  float phi=vUv.x*6.28318530718, theta=(1.0-vUv.y)*3.14159265359;
  vec3 p=vec3(-cos(phi)*sin(theta),cos(theta),sin(phi)*sin(theta));
  vec3 q=p*1.0+uOff; float lat=abs(p.y);
  vec3 col=vec3(0.5); float h=0.5, rough=0.9, emi=0.0;
  if(uPass==2){ // clouds
    vec3 w=q*1.6+vec3(fbm(q*1.2+3.0,3),fbm(q*1.2+8.0,3),fbm(q*1.2+13.0,3))*0.8;
    float swirl=snoise(q*0.8)*2.0; w+=vec3(sin(swirl+p.y*6.0),0.0,cos(swirl))*0.15;
    float c=fbm(w*2.3,6)+0.12*(1.0-lat)-0.07;
    float a=smoothstep(0.0,0.45,c)*0.85; a*=1.0-smoothstep(0.92,1.0,lat)*0.5;
    gl_FragColor=vec4(a,a,a,1.0); return;   // alphaMap reads the green channel
  }
  vec3 w=q+0.35*vec3(fbm(q*1.3+1.7,4),fbm(q*1.3+9.2,4),fbm(q*1.3+4.4,4));
  if(uType==5){ // gas giant: bands, turbulence, one big storm
    float turb=fbm(q*vec3(2.0,6.0,2.0),5);
    float b=p.y*uBand+turb*0.7+0.25*snoise(q*vec3(0.6,9.0,0.6));
    float t=0.5+0.5*sin(b*3.14159), t2=0.5+0.5*sin(b*1.73+1.3);
    col=mix(uP[0],uP[1],t); col=mix(col,uP[2],smoothstep(0.55,1.0,t2)*0.75);
    col=mix(col,uP[3],smoothstep(0.2,0.9,fbm(q*vec3(3.0,14.0,3.0),4)*0.5+0.5)*0.35);
    vec3 sc=normalize(uStorm); vec3 dv=p-sc; dv.y*=1.9; float sd=length(dv);
    float sw=snoise(vec3(dv.x*9.0,dv.y*9.0,sd*6.0));
    col=mix(col,mix(uP[4],uP[5],0.5+0.5*sw),smoothstep(0.26,0.06,sd)*0.9);
    col=mix(col,uP[5],smoothstep(0.3,0.26,sd)*smoothstep(0.2,0.26,sd)*0.6);
    h=0.5; rough=1.0;
  } else if(uType==4){ // lava
    float n=fbm(w*2.0,6);
    float c1=pow(1.0-abs(snoise(w*5.0)),14.0), c2=pow(1.0-abs(snoise(w*13.0+3.0)),20.0);
    float glow=clamp(c1+c2*0.7+smoothstep(-0.25,-0.55,n),0.0,1.0);
    col=mix(uP[0],uP[1],smoothstep(-0.4,0.5,n)); col=mix(col,uP[2],smoothstep(0.3,0.8,n)*0.5);
    col=mix(col,uP[3],glow); emi=glow; h=n*0.5+0.5-glow*0.1; rough=mix(0.85,0.35,glow);
  } else if(uType==7){ // barren, cratered
    float n=fbm(w*1.6,5)*0.4;
    float c=crater(q*2.6)*0.7+crater(q*6.0+5.0)*0.4+crater(q*14.0+9.0)*0.22+crater(q*30.0+2.0)*0.1;
    h=n+c;
    float mare=smoothstep(0.05,0.3,fbm(q*0.8+20.0,3));
    col=mix(uP[0],uP[1],smoothstep(-0.45,0.25,h)); col=mix(col,uP[2],smoothstep(0.15,0.45,h+c*0.5));
    col=mix(col,uP[0]*0.75,mare*0.55); col*=0.92+0.16*snoise(q*40.0);
    h=h*0.5+0.5; rough=0.95;
  } else if(uType==3){ // ice
    float n=fbm(w*1.5,6);
    float cr=pow(1.0-abs(snoise(w*4.5)),12.0)+pow(1.0-abs(snoise(w*11.0+2.0)),16.0)*0.6;
    col=mix(uP[1],uP[2],smoothstep(-0.3,0.4,n)); col=mix(col,uP[3],smoothstep(0.3,0.7,n)); col=mix(col,uP[0],clamp(cr,0.0,1.0)*0.85);
    h=0.5+n*0.4-cr*0.12; rough=0.3+0.35*cr;
  } else if(uType==2){ // desert
    float n=fbm(w*1.4,6);
    float dunes=0.5+0.5*sin(dot(w,normalize(vec3(1.0,0.25,0.7)))*70.0+fbm(w*4.0,3)*7.0);
    float canyon=pow(1.0-abs(snoise(w*2.6)),7.0);
    float e=n*0.6+dunes*0.04-canyon*0.3;
    col=mix(uP[0],uP[1],smoothstep(-0.5,0.0,e)); col=mix(col,uP[2],smoothstep(0.0,0.3,e)); col=mix(col,uP[3],smoothstep(0.3,0.6,e));
    col=mix(col,uP[4],canyon*0.65);
    float cap=smoothstep(0.955,0.985,lat+0.03*snoise(q*6.0)); col=mix(col,uP[5],cap);
    h=0.5+e*0.5; rough=0.95-cap*0.4;
  } else { // terran (0), ocean (1), toxic (6)
    float n=fbm(w*uFreq,7), m=ridged(w*uFreq*1.8+3.1,6);
    float e=n*0.75+(m-0.45)*0.45*smoothstep(-0.1,0.4,n)-uSea;
    if(e<0.0){
      float d=clamp(-e/0.35,0.0,1.0);
      col=mix(uP[1],uP[0],pow(d,0.6)); rough=0.42; h=0.5;
    } else {
      float moist=fbm(q*2.2+11.0,4)*0.5+0.5;
      vec3 low=mix(uP[2],uP[3],smoothstep(0.0,0.035,e));
      low=mix(low,uP[2]*0.97,smoothstep(0.52,0.32,moist)*smoothstep(0.15,0.55,1.0-lat)*(uType==6?0.3:1.0));
      col=mix(low,uP[4],smoothstep(0.1,0.3,e)); col=mix(col,uP[5],smoothstep(0.34,0.46,e));
      rough=0.85; h=0.5+e*0.8;
      float cityA=smoothstep(0.55,0.9,snoise(q*42.0)), cityB=smoothstep(0.05,0.35,fbm(q*6.0+5.0,3));
      emi=cityA*cityB*step(e,0.14)*(uType==6?1.6:1.0);
    }
    float cap=smoothstep(0.93,0.97,lat+0.04*snoise(q*6.0))*(uType==6?0.0:1.0);
    col=mix(col,uP[5],cap); rough=mix(rough,0.45,cap); emi*=1.0-cap; h=mix(h,0.52,cap);
  }
  if(uPass==0) gl_FragColor=vec4(col,1.0);
  else gl_FragColor=vec4(clamp(h,0.0,1.0),clamp(rough,0.0,1.0),clamp(emi,0.0,1.0),1.0);
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform vec3 uA, uB, uC; uniform vec3 uOff; uniform vec3 uPole;
${NOISE}
void main(){
  float phi=vUv.x*6.28318530718, theta=(1.0-vUv.y)*3.14159265359;
  vec3 d=vec3(-cos(phi)*sin(theta),cos(theta),sin(phi)*sin(theta));
  float g=dot(d,normalize(uPole));                       // distance from the galactic plane
  float band=exp(-g*g*14.0);
  vec3 q=d*2.0+uOff;
  float n=fbm(q*1.5,6)*0.5+0.5, n2=fbm(q*3.0+7.0,5)*0.5+0.5;
  float dust=smoothstep(0.45,0.75,fbm(q*4.0+2.0,5)*0.5+0.5);
  vec3 col=vec3(0.004,0.005,0.012);
  col+=uA*pow(n,3.0)*0.10; col+=uB*pow(n2,4.0)*0.09*(0.4+band);
  col+=mix(vec3(0.05,0.045,0.06),uC*0.12,0.5)*band*(0.6+0.8*n2)*(1.0-dust*0.8);
  float st=pow(max(0.0,snoise(d*420.0)),18.0)*0.6+pow(max(0.0,snoise(d*900.0+3.0)),24.0)*0.5*(0.3+band);
  col+=vec3(st);
  gl_FragColor=vec4(col,1.0);
}`;

const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }';

function makeRT(w, h, srgb) {
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.anisotropy = 4;
  return rt;
}

class Baker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.Camera();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uType: { value: 0 }, uPass: { value: 0 }, uOff: { value: new THREE.Vector3() }, uSea: { value: 0 }, uFreq: { value: 1.6 }, uBand: { value: 8 }, uP: { value: [] }, uStorm: { value: new THREE.Vector3(1, 0, 0) } },
    });
    this.sky = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: SKY_FRAG, depthTest: false, depthWrite: false,
      uniforms: { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uC: { value: new THREE.Color() }, uOff: { value: new THREE.Vector3() }, uPole: { value: new THREE.Vector3(0, 1, 0) } } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }
  draw(material, rt) {
    const r = this.renderer, prev = r.getRenderTarget();
    this.quad.material = material;
    r.setRenderTarget(rt); r.render(this.scene, this.cam); r.setRenderTarget(prev);
  }
  planet(spec, size) {
    const u = this.mat.uniforms;
    u.uType.value = TYPE_ID[spec.type]; u.uOff.value.copy(spec.noiseOff); u.uSea.value = spec.sea; u.uFreq.value = spec.freq; u.uBand.value = spec.band;
    u.uP.value = spec.palette; u.uStorm.value.copy(spec.storm);
    const [w, h] = size;
    const color = makeRT(w, h, true), data = makeRT(w, h, false);
    u.uPass.value = 0; this.draw(this.mat, color);
    u.uPass.value = 1; this.draw(this.mat, data);
    let clouds = null;
    if (spec.clouds) { clouds = makeRT(w, h, false); u.uPass.value = 2; this.draw(this.mat, clouds); }
    return { color, data, clouds };
  }
  skybox(sys, size) {
    const rt = makeRT(size[0], size[1], true);
    const u = this.sky.uniforms;
    u.uA.value.copy(sys.nebula[0]); u.uB.value.copy(sys.nebula[1]); u.uC.value.copy(sys.nebula[2]); u.uOff.value.copy(sys.skyOff); u.uPole.value.copy(sys.galaxyPole);
    this.draw(this.sky, rt);
    rt.texture.mapping = THREE.EquirectangularReflectionMapping;
    return rt;
  }
}

const TYPE_ID = { terran: 0, ocean: 1, desert: 2, ice: 3, lava: 4, gas: 5, toxic: 6, barren: 7 };
const TYPES = {
  terran: { label: 'Garden world', r: [1000, 1800], atmo: '#6fb6ff', clouds: true, bump: 1.2 },
  ocean: { label: 'Ocean world', r: [900, 1700], atmo: '#5fd4ff', clouds: true, bump: 0.8 },
  desert: { label: 'Desert world', r: [700, 1500], atmo: '#ffbb77', clouds: false, bump: 1.4 },
  ice: { label: 'Ice world', r: [600, 1400], atmo: '#cfe9ff', clouds: false, bump: 1.0 },
  lava: { label: 'Lava world', r: [500, 1100], atmo: '#ff7a3a', clouds: false, bump: 1.4 },
  gas: { label: 'Gas giant', r: [2200, 3600], atmo: '#ffd9a0', clouds: false, bump: 0 },
  toxic: { label: 'Toxic world', r: [800, 1500], atmo: '#b6ff6a', clouds: true, bump: 1.0 },
  barren: { label: 'Barren rock', r: [350, 900], atmo: null, clouds: false, bump: 2.0 },
};
const PALETTES = {
  terran: [['#0a2752', '#1f6fa8', '#d6c393', '#3f7d39', '#6e5d44', '#f3f5f8'], ['#0c2a46', '#2a86a0', '#cdb98a', '#5a8a3a', '#7a6a55', '#ffffff'], ['#0b2140', '#246a9a', '#e0cfa0', '#2f6b3c', '#5c5048', '#eef3f8']],
  ocean: [['#04203f', '#17a3b5', '#ead9ad', '#3f9a4f', '#7c7062', '#ffffff'], ['#061a3a', '#2f78c8', '#e8d6a8', '#4c8a3c', '#6f6458', '#f4f8fb']],
  desert: [['#5e3219', '#b0602c', '#d48b48', '#ebb87a', '#7e4f30', '#f1e6d8'], ['#4a2c22', '#9a5236', '#c98a5a', '#e3c08c', '#6a3e2e', '#f6ede0'], ['#3c3326', '#8a7652', '#bba477', '#e2cf9f', '#5e4f3a', '#f3eee4']],
  ice: [['#3f6f9a', '#9fc2dd', '#d5e6f3', '#ffffff', '#7f97ad', '#ffffff'], ['#5a6fa8', '#a9b8e6', '#d9e0f7', '#fbfcff', '#8a90b5', '#ffffff']],
  lava: [['#0e0b0a', '#2a201c', '#4a2a1d', '#ff5a1a', '#ffd27a', '#ffffff'], ['#0c0a10', '#251c26', '#3b2231', '#ff3a5a', '#ffb07a', '#ffffff']],
  gas: [['#d9c2a0', '#a8754a', '#efe3cc', '#7a4d2e', '#c9542e', '#f4d7b0'], ['#7fa4d6', '#3b5fa8', '#d3e3f7', '#24407a', '#f2f6ff', '#9ec0f0'], ['#c7a6d9', '#7a5aa8', '#efe0f7', '#4f3a7a', '#ffd0f0', '#b490e0'], ['#e3d8a4', '#b49a52', '#f6f0d2', '#7f6a33', '#f0a060', '#fff2c8']],
  toxic: [['#2a0e44', '#6a2a8f', '#b8d63a', '#6fa020', '#3e5a18', '#d9f07a'], ['#0e3a2a', '#1f8a6a', '#e0d040', '#a0b020', '#5a5a18', '#f0f0a0']],
  barren: [['#3a3a3e', '#6e6c6a', '#a39e96', '#c4bfb5', '#555', '#ddd'], ['#3e342e', '#76665a', '#a8978a', '#cbbfb2', '#554', '#e6ddd2'], ['#30343a', '#5e6670', '#959ea8', '#c0c7cf', '#445', '#dde']],
};

const SYL_A = ['Ka', 'Ve', 'Zo', 'Lu', 'Tha', 'Ny', 'Or', 'Be', 'Xe', 'Ae', 'Co', 'Mi', 'So', 'Te', 'Qua', 'Rho', 'Ish', 'Va', 'Ely', 'Ari', 'Pol', 'Gan', 'Kep', 'Ta', 'Uri', 'Ze', 'Ori', 'Mara', 'Sel', 'Dra'];
const SYL_B = ['ra', 'no', 'li', 'ta', 'vo', 'ri', 'sa', 'du', 'ne', 'ka', 'mo', 'phe', 'lo', 'ze', 'vu', 'gan', 'thi', 'ber'];
const SYL_C = ['nia', 'ris', 'tor', 'lia', 'gon', 'mar', 'xis', 'dea', 'rus', 'vin', 'pha', 'lune', 'ion', 'ara', 'ette', 'os', 'en', 'is'];
const SUFFIX = ['', '', '', ' Prime', ' II', ' III', ' Minor', ' b', ' VII', ' Major', ' IV'];
const BLURBS = {
  terran: ['Blue skies, green hills and the friendliest customs officers in the sector.', 'Rated the galaxy\'s best picnic spot three cycles running.', 'Bring a jacket: the mountains are tall and the gift shops are taller.'],
  ocean: ['Ninety-eight percent water, two percent beach bar.', 'The waves are three storeys high. Surf lessons sold separately.', 'Every island has a lighthouse and every lighthouse has a café.'],
  desert: ['Dunes taller than mountains. Sunscreen sold separately.', 'Canyon tours at dawn, sand in your shoes until retirement.', 'Famous for sunsets that last four hours.'],
  ice: ['Ice-fishing paradise. The fish are the size of buses.', 'Glaciers glow blue at noon. Gloves recommended, mittens better.', 'The quietest planet on the brochure. You can hear snow land.'],
  lava: ['Hot springs. Very hot. Do not swim.', 'Night-side lava rivers make the best postcards in the system.', 'Guided tours keep a respectful three-kilometre distance.'],
  gas: ['No ground to stand on, but the cloud resorts have a view.', 'The big storm is older than most civilisations. It has a gift shop.', 'Ring-skating season opens whenever the rings agree.'],
  toxic: ['Acid lakes in eleven flavours. Admire from orbit.', 'The forests glow at night, and they are not friendly about it.', 'Voted Most Photogenic Hazard two years in a row.'],
  barren: ['Craters galore. Quiet, cheap and very, very grey.', 'Perfect for stargazing: no air, no clouds, no excuses.', 'Home of the solar system\'s loneliest snack bar.'],
};
const REVIEWERS = ['Zib from Andromeda', 'a tourist from Vega', 'Mrs. Okonkwo, retired pilot', 'two hikers from Tau Ceti', 'the Kowalski family', 'a very tall visitor', 'Grandpa Ruiz', 'an anonymous comet'];
const QUOTES = ['Would orbit again.', 'Lost my luggage, found myself.', 'The view made me forget the queue.', 'Five stars for the gravity alone.', 'The postcards do not do it justice.', 'Ten out of ten, would wave at it.'];

const hex = (h) => new THREE.Color(h);
export function planetName(r) {
  const n = pick(r, SYL_A) + pick(r, SYL_B) + (r() < 0.6 ? pick(r, SYL_C) : '');
  return n + pick(r, SUFFIX);
}

function makeSpec(r, type, radius, position, name) {
  const t = TYPES[type];
  const pal = pick(r, PALETTES[type]).map((c) => {
    const col = hex(c); const hsl = {}; col.getHSL(hsl);
    col.setHSL((hsl.h + (r() - 0.5) * 0.05 + 1) % 1, Math.min(1, hsl.s * (0.85 + r() * 0.3)), hsl.l);
    return col;
  });
  return {
    type, name, radius, position, label: t.label,
    palette: pal, sea: type === 'ocean' ? range(r, 0.18, 0.3) : type === 'terran' ? range(r, -0.02, 0.08) : type === 'toxic' ? range(r, 0.0, 0.1) : 0,
    freq: range(r, 0.85, 1.4), band: range(r, 6, 14), noiseOff: new THREE.Vector3(r() * 100, r() * 100, r() * 100),
    storm: new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5),
    clouds: t.clouds, atmo: t.atmo ? hex(t.atmo) : null, bump: t.bump,
    tilt: range(r, -0.45, 0.45), spin: range(r, 0.004, 0.02) * (r() < 0.15 ? -1 : 1),
    rings: type === 'gas' ? r() < 0.7 : (type === 'ice' || type === 'barren') && r() < 0.15,
    ringPalette: [hex(pick(r, ['#d8c8a8', '#c8d8e8', '#e8d0c0', '#bfb6cc'])), hex(pick(r, ['#8a7a60', '#7a8aa0', '#a08070', '#6f6a80']))],
    info: {
      blurb: pick(r, BLURBS[type]), review: `“${pick(r, QUOTES)}” — ${pick(r, REVIEWERS)}`, stars: 3 + Math.floor(r() * 3),
      gravity: type === 'gas' ? range(r, 1.8, 3.2) : type === 'barren' ? range(r, 0.1, 0.4) : range(r, 0.4, 1.6),
      temp: { terran: [5, 30], ocean: [10, 28], desert: [30, 70], ice: [-120, -20], lava: [400, 1100], gas: [-160, -90], toxic: [40, 120], barren: [-170, 120] }[type],
      day: range(r, 6, 60),
    },
    moons: [],
  };
}

// One star system. Index 0 is home: Spaceport Aurora and Aurora Prime ahead of the launch bay.
export function genSystem(index) {
  const r = rng(1009 + index * 7919);
  const name = index === 0 ? 'Aurora System' : `${pick(r, ['Kestrel', 'Tavira', 'Lyra', 'Vesta', 'Calypso', 'Nadir', 'Halcyon', 'Juno', 'Perseid', 'Meridian', 'Solano', 'Ember'])}-${10 + Math.floor(r() * 89)}`;
  const sunDir = index === 0 ? new THREE.Vector3(0.62, 0.3, 0.72).normalize() : new THREE.Vector3(r() * 2 - 1, range(r, 0.05, 0.4), r() * 2 - 1).normalize();
  const sunColor = hex(pick(r, ['#fff3e0', '#ffe9c8', '#eef3ff', '#ffd9b0']));
  const order = ['terran', 'ocean', 'desert', 'ice', 'lava', 'gas', 'toxic', 'barren'];
  const planets = [];
  const used = [];
  const place = (minD, maxD) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = r() * Math.PI * 2, d = range(r, minD, maxD);
      const p = new THREE.Vector3(Math.cos(a) * d, range(r, -1800, 1800), Math.sin(a) * d);
      if (index === 0 && p.z < 0 && Math.abs(p.x) < 6000) continue;        // keep the launch line clear
      if (used.every((u) => u.distanceTo(p) > 14000)) { used.push(p); return p; }
    }
    const p = new THREE.Vector3((r() - 0.5) * 2 * maxD, 0, (r() - 0.5) * 2 * maxD); used.push(p); return p;
  };
  if (index === 0) {
    const home = makeSpec(r, 'terran', 2300, new THREE.Vector3(1400, -900, -9800), 'Aurora Prime');
    home.info.blurb = 'Home sweet home. Every tour of the galaxy starts and ends here.';
    planets.push(home); used.push(home.position, new THREE.Vector3());
  }
  const count = index === 0 ? 6 : 6 + Math.floor(r() * 3);
  const types = index === 0 ? ['gas', 'desert', 'ice', 'lava', 'ocean', 'toxic'] : [];
  while (types.length < count) types.push(pick(r, order));
  for (let i = planets.length ? 1 : 0, k = 0; planets.length < (index === 0 ? 7 : count); i++, k++) {
    const type = types[k % types.length];
    const t = TYPES[type];
    planets.push(makeSpec(r, type, range(r, t.r[0], t.r[1]), place(16000, 70000), planetName(r)));
  }
  for (const p of planets) {        // moons
    const nm = p.type === 'gas' ? 1 + Math.floor(r() * 2) : r() < 0.35 ? 1 : 0;
    for (let m = 0; m < nm; m++) {
      const mt = r() < 0.7 ? 'barren' : 'ice';
      const ms = makeSpec(r, mt, p.radius * range(r, 0.12, 0.22), new THREE.Vector3(), `${p.name.split(' ')[0]} ${['α', 'β', 'γ'][m]}`);
      ms.label = 'Moon'; ms.rings = false;
      ms.orbit = { radius: p.radius * range(r, 2.4, 3.6), speed: range(r, 0.01, 0.03), phase: r() * Math.PI * 2, incl: range(r, -0.3, 0.3) };
      p.moons.push(ms);
    }
  }
  const nebula = [hex(pick(r, ['#4a6cff', '#ff4fa0', '#3fd6c0', '#ff8a3c', '#9a5cff'])), hex(pick(r, ['#ff5a7a', '#5affd0', '#ffd25a', '#6a8aff', '#c05aff'])), hex(pick(r, ['#ffe0b0', '#d0e0ff', '#ffd0e0']))];
  return { index, name, sunDir, sunColor, planets, nebula, skyOff: new THREE.Vector3(r() * 50, r() * 50, r() * 50), galaxyPole: new THREE.Vector3(r() - 0.5, 1, r() - 0.5).normalize() };
}

// ---------------------------------------------------------------- scene objects
const ATMO_VERT = /* glsl */`
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWN; varying vec3 vWP;
void main(){ vWN=normalize(mat3(modelMatrix)*normal); vec4 wp=modelMatrix*vec4(position,1.0); vWP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp;
#include <logdepthbuf_vertex>
}`;
const ATMO_FRAG = /* glsl */`
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform vec3 uSun; uniform float uK; uniform float uEdge;
varying vec3 vWN; varying vec3 vWP;
void main(){
#include <logdepthbuf_fragment>
  vec3 V=normalize(cameraPosition-vWP);
  float f=-dot(V,normalize(vWN));
  float i=smoothstep(0.0,uEdge,f); i=i*i;
  float sd=dot(normalize(vWN),uSun);
  float day=smoothstep(-0.35,0.45,sd);
  vec3 c=mix(uColor,vec3(1.0,0.55,0.3),smoothstep(0.35,0.0,abs(sd))*0.6);
  gl_FragColor=vec4(c*i*day*uK,1.0);
}`;

export class Planet {
  constructor(spec, baked, sunDirUniform, detail) {
    this.spec = spec;
    this.group = new THREE.Group();
    this.group.position.copy(spec.position);
    this.tiltGroup = new THREE.Group(); this.tiltGroup.rotation.z = spec.tilt; this.group.add(this.tiltGroup);
    const seg = detail > 1 ? 160 : 112;
    const geo = new THREE.SphereGeometry(spec.radius, seg, seg / 2);
    const em = spec.type === 'lava' ? 0xff7a2a : spec.type === 'toxic' ? 0x9cff4a : 0xffcf7a;
    const mat = new THREE.MeshStandardMaterial({
      map: baked.color.texture, roughnessMap: baked.data.texture, roughness: 1, metalness: 0,
      bumpMap: spec.bump ? baked.data.texture : null, bumpScale: spec.bump * 3,
      emissive: em, emissiveMap: baked.data.texture, emissiveIntensity: spec.type === 'lava' ? 2.2 : 1.6,
    });
    const dayGlow = spec.type === 'lava' ? 0.75 : 0.0;
    const atmoCol = spec.atmo || new THREE.Color(0, 0, 0), atmoK = spec.atmo ? 0.55 : 0;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uSun = sunDirUniform; sh.uniforms.uDayGlow = { value: dayGlow }; sh.uniforms.uAtmo = { value: atmoCol }; sh.uniforms.uAtmoK = { value: atmoK };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWN; uniform vec3 uSun; uniform float uDayGlow; uniform vec3 uAtmo; uniform float uAtmoK;')
        .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
          float eMask = texture2D( emissiveMap, vEmissiveMapUv ).b;
          float nightF = smoothstep( 0.12, -0.22, dot( normalize( vWN ), uSun ) );
          totalEmissiveRadiance *= eMask * mix( uDayGlow, 1.0, nightF );
        #endif`)
        .replace('#include <opaque_fragment>', `{ float sdA = dot( normalize( vWN ), uSun );
          float fres = pow( 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
          outgoingLight += uAtmo * fres * uAtmoK * smoothstep( -0.3, 0.6, sdA ); }
        #include <opaque_fragment>`);
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.tiltGroup.add(this.mesh);
    if (baked.clouds) {
      const cm = new THREE.MeshStandardMaterial({ map: null, alphaMap: baked.clouds.texture, color: spec.type === 'toxic' ? 0xeaf7b0 : 0xffffff, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * 1.012, seg, seg / 2), cm);
      this.tiltGroup.add(this.clouds);
    }
    if (spec.atmo) {
      const am = new THREE.ShaderMaterial({ vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: spec.atmo }, uSun: sunDirUniform, uK: { value: spec.type === 'gas' ? 0.55 : 1.2 }, uEdge: { value: 0.5 } } });
      this.atmo = new THREE.Mesh(new THREE.SphereGeometry(spec.radius * (spec.type === 'gas' ? 1.05 : 1.12), 64, 32), am);
      this.group.add(this.atmo);
    }
    if (spec.rings) {
      const r0 = spec.radius * 1.35, r1 = spec.radius * 2.35;
      const rg = new THREE.RingGeometry(r0, r1, 160, 1);
      const pos = rg.attributes.position, uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) { const rr = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (rr - r0) / (r1 - r0), 0.5); }
      const c = document.createElement('canvas'); c.width = 512; c.height = 2; const g = c.getContext('2d');
      const rr = rng(Math.floor(spec.radius));
      for (let x = 0; x < 512; x++) {
        const k = rr(), a = Math.max(0, Math.sin(x * 0.05 + k) * 0.3 + 0.45 + (rr() - 0.5) * 0.35) * (x < 20 || x > 495 ? 0.2 : 1) * (x > 300 && x < 318 ? 0.1 : 1);
        const col = spec.ringPalette[0].clone().lerp(spec.ringPalette[1], rr());
        g.fillStyle = `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},${a})`; g.fillRect(x, 0, 1, 2);
      }
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      this.rings = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, emissive: 0x222222, emissiveMap: tex }));
      this.rings.rotation.x = -Math.PI / 2 + 0.08;
      this.tiltGroup.add(this.rings);
    }
    this.visited = false;
    this.textures = [baked.color, baked.data, baked.clouds].filter(Boolean);
  }
  get name() { return this.spec.name; }
  get radius() { return this.spec.radius; }
  update(dt) {
    this.mesh.rotation.y += this.spec.spin * dt;
    if (this.clouds) this.clouds.rotation.y += this.spec.spin * dt * 1.35;
    const o = this.spec.orbit;
    if (o && this.parent) {
      o.phase += o.speed * dt;
      this.group.position.set(Math.cos(o.phase) * o.radius, Math.sin(o.phase) * o.radius * o.incl, Math.sin(o.phase) * o.radius).add(this.parent.group.position);
    }
  }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose(); o.material.dispose(); } });
    for (const t of this.textures) t.dispose();
  }
}

export class StarSystem {
  constructor(renderer, scene, sys, { low = false } = {}) {
    this.sys = sys; this.scene = scene; this.renderer = renderer;
    this.baker = new Baker(renderer);
    this.sunUniform = { value: sys.sunDir.clone() };
    this.group = new THREE.Group(); scene.add(this.group);
    this.planets = [];
    this.queue = [];
    for (const spec of sys.planets) {
      this.queue.push({ spec, parent: null, size: !low && spec.radius > 1500 ? [2048, 1024] : [1024, 512] });
      for (const m of spec.moons) this.queue.push({ spec: m, parentSpec: spec, size: [512, 256] });
    }
    this.total = this.queue.length;
    // sky
    this.skyRT = this.baker.skybox(sys, [2048, 1024]);
    scene.background = this.skyRT.texture;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.env = this.pmrem.fromEquirectangular(this.skyRT.texture).texture;
    // star sprite + light
    this.sun = new THREE.DirectionalLight(sys.sunColor, 2.3);
    this.sun.position.copy(sys.sunDir).multiplyScalar(1000);
    scene.add(this.sun); scene.add(this.sun.target);
    this.sunSprite = makeSunSprite(sys.sunColor);
    this.sunSprite.position.copy(sys.sunDir).multiplyScalar(400000);
    this.group.add(this.sunSprite);
    this.stars = makeStars(sys.index);
    this.group.add(this.stars);
  }
  // bake a few planets per call so the page never freezes for long
  bakeSome(maxMs = 30) {
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < maxMs) {
      const job = this.queue.shift();
      const baked = this.baker.planet(job.spec, job.size);
      const p = new Planet(job.spec, baked, this.sunUniform, job.parentSpec ? 1 : 2);
      if (job.parentSpec) { p.parent = this.planets.find((x) => x.spec === job.parentSpec); p.isMoon = true; p.update(0); }
      this.planets.push(p); this.group.add(p.group);
    }
    return 1 - this.queue.length / this.total;
  }
  get ready() { return this.queue.length === 0; }
  update(dt, camPos) {
    for (const p of this.planets) p.update(dt);
    this.stars.position.copy(camPos); this.sunSprite.position.copy(this.sys.sunDir).multiplyScalar(400000).add(camPos);
  }
  dispose() {
    for (const p of this.planets) p.dispose();
    this.scene.remove(this.group); this.scene.remove(this.sun); this.scene.remove(this.sun.target);
    this.skyRT.dispose(); this.env.dispose(); this.pmrem.dispose();
    this.stars.geometry.dispose();
  }
}

function makeSunSprite(color) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.06, '#ffffff'); gr.addColorStop(0.12, `#${color.getHexString()}`);
  gr.addColorStop(0.35, 'rgba(255,190,120,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(90000);
  s.renderOrder = -1;
  return s;
}

function makeStars(seed) {
  const r = rng(77 + seed * 31), n = 7000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), d = 600000;
    pos.set([Math.cos(a) * s * d, u * d, Math.sin(a) * s * d], i * 3);
    const t = r();
    c.setHSL(t < 0.2 ? 0.6 : t < 0.8 ? 0.12 : 0.04, t < 0.8 ? 0.15 : 0.6, 0.55 + r() * 0.45);
    const k = Math.pow(r(), 3) * 1.6 + 0.35; c.multiplyScalar(k);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const cv = document.createElement('canvas'); cv.width = cv.height = 32; const cg = cv.getContext('2d');
  const gr = cg.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  cg.fillStyle = gr; cg.fillRect(0, 0, 32, 32);
  const m = new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = -2;
  return p;
}
