import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { statusOf, statusLabels } from './state.js';
import { stageDurations } from './journey.js';

const colors = { working: '#6a8b53', waiting: '#d59942', available: '#83918d', paused: '#9c9b86', review:'#8297a0', changes:'#c19269', blocked:'#a58c5c', assigned:'#8d9b72' };
const material = (color, roughness = .8) => new THREE.MeshStandardMaterial({ color, roughness });
const mats = { cream: material('#efeee4'), wood: material('#d5bc96'), legs: material('#aeb6a7'), dark: material('#36443c'), white: material('#f4f6ef', .45), green: material('#718653'), pot: material('#c89370'), floor: material('#e2d7bf'), wall: material('#e5e5d9'), metal: material('#86988e', .45) };
const v = new THREE.Vector3();
function box(parent, w, h, d, x, y, z, mat) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function sphere(parent, r, x, y, z, mat, scale) {
  const o = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat); o.position.set(x, y, z); if (scale) o.scale.set(...scale); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function cylinder(parent, top, bottom, h, x, y, z, mat) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 24), mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function rounded(parent, w, d, h, radius, x, y, z, mat) {
  const s = new THREE.Shape(), a = -w/2, b = -d/2, r = radius;
  s.moveTo(a+r,b); s.lineTo(a+w-r,b); s.quadraticCurveTo(a+w,b,a+w,b+r); s.lineTo(a+w,b+d-r); s.quadraticCurveTo(a+w,b+d,a+w-r,b+d); s.lineTo(a+r,b+d); s.quadraticCurveTo(a,b+d,a,b+d-r); s.lineTo(a,b+r); s.quadraticCurveTo(a,b,a+r,b);
  const geo = new THREE.ExtrudeGeometry(s,{depth:h,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.035,bevelThickness:.035,curveSegments:6});
  geo.rotateX(-Math.PI/2); const o = new THREE.Mesh(geo,mat); o.position.set(x,y,z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}
function plant(parent, x, z, scale = 1) {
  const g = new THREE.Group(); g.position.set(x, .12, z); g.scale.setScalar(scale); parent.add(g);
  cylinder(g,.35,.27,.58,0,.29,0,mats.pot); cylinder(g,.33,.33,.035,0,.59,0,mats.dark);
  cylinder(g,.035,.035,1.2,0,1.1,0,mats.green);
  const leaves = ['#788f58','#8da16b','#627b48'].map(c=>material(c));
  for(let i=0;i<9;i++){const t=i*2.4;const l=sphere(g,.36,Math.sin(t)*.32,.98+i*.075,Math.cos(t)*.27,leaves[i%3],[.58,1.2,.7]);l.rotation.z=Math.sin(t)*.7;l.rotation.x=Math.cos(t)*.65;}
}
function screenTexture(member) {
  const c = document.createElement('canvas'); c.width=384;c.height=256;const ctx=c.getContext('2d');
  ctx.fillStyle='#fcfcf7';ctx.fillRect(0,0,384,256);ctx.fillStyle='#e6e9df';ctx.fillRect(0,0,384,24);ctx.fillStyle=member.color;ctx.fillRect(0,0,96,24);
  ctx.fillStyle='#dde3d6';ctx.fillRect(0,24,48,232);for(let i=0;i<5;i++){ctx.fillStyle=i===1?'#93a17c':'#bdc5b4';ctx.fillRect(10,42+i*23,28,7);}
  if(/vidéo|Videomaker/.test(member.role)){
    ctx.fillStyle='#34433d';ctx.fillRect(63,41,303,143);ctx.fillStyle=member.color;ctx.beginPath();ctx.arc(214,104,42,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f9f5e7';ctx.beginPath();ctx.moveTo(202,86);ctx.lineTo(202,124);ctx.lineTo(235,105);ctx.fill();for(let i=0;i<3;i++){ctx.fillStyle=['#a5b895','#d3aa8c','#c4c9bd'][i];ctx.fillRect(64+i*23,198+i*15,270-i*32,9);}
  }else if(/tráfego/.test(member.role)){
    ctx.fillStyle='#697b5b';for(let i=0;i<6;i++)ctx.fillRect(75+i*44,210-(i*19+36),26,i*19+36);ctx.fillStyle='#d9dfd0';ctx.fillRect(69,47,270,11);
  }else if(/Designer|Web designer/.test(member.role)){
    ctx.fillStyle=member.color;ctx.fillRect(65,40,184,103);ctx.fillStyle='#e3d8b5';ctx.fillRect(258,40,103,103);ctx.fillStyle='#a4b596';ctx.fillRect(65,154,103,77);ctx.fillStyle='#e9c4a8';ctx.fillRect(179,154,182,77);
  }else{
    for(let i=0;i<9;i++){ctx.fillStyle=i===0?member.color:i%3===0?'#b8c3ad':'#d5dbcF';ctx.fillRect(68,43+i*20,i===0?180:278-(i%3)*32,i===0?14:8);}
  }
  const tex = new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;return tex;
}
function plaque(parent, text, detail, w, h, x, y, z, { background='#405738', ink='#edf3dc' }={}) {
  const canvas=document.createElement('canvas');canvas.width=768;canvas.height=256;
  const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,768,256);
  c.fillStyle=ink;c.font='bold 72px sans-serif';c.textAlign='center';c.fillText(text,384,114);
  c.globalAlpha=.76;c.font='28px sans-serif';c.fillText(detail,384,179);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:texture}));mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
function leadershipArea(parent,centerZ,hasDirector){
  const z=-centerZ-3.65;
  rounded(parent,8.0,3.25,.095,.32,3.72,.075,z+.26,material('#bdc9a5'));
  // The director has a distinct studio workstation; the brain is a separate knowledge object.
  box(parent,7.2,.75,.12,3.72,.55,z-1.24,material('#788d61'));
  for(let i=0;i<20;i++)box(parent,.045,.70,.035,.35+i*.35,.55,z-1.16,material('#9caf82'));
  if(hasDirector){
    rounded(parent,3.0,1.60,.09,.16,1.85,1.02,z+.05,material('#587148'));
    plaque(parent,'DIRETOR','PLANEJA · COORDENA · REVISA',2.1,.56,1.85,.67,z+.88);
    const divider=box(parent,.035,1.9,1.28,3.68,1.09,z-.10,material('#a7b58e'));divider.receiveShadow=true;
  }
  const line=new THREE.CatmullRomCurve3([new THREE.Vector3(3.18,.22,z+.94),new THREE.Vector3(4.0,.22,z+1.14),new THREE.Vector3(4.63,.22,z+.52),new THREE.Vector3(5.86,.22,z+.25)]);
  parent.add(new THREE.Mesh(new THREE.TubeGeometry(line,40,.024,7,false),new THREE.MeshBasicMaterial({color:'#ecedcb'})));
}
function companyBrain(parent,x,z,info){
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);
  const base=material('#6b8056'),trim=material('#dfd9bc'),pink=material('#d8a28f',.65),fold=material('#b77d69',.85);
  cylinder(g,.88,1.00,.16,0,.16,0,base);cylinder(g,.66,.77,.70,0,.57,0,mats.cream);
  cylinder(g,.76,.76,.075,0,.96,0,trim);cylinder(g,.63,.63,.055,0,1.02,0,base);
  const halo=new THREE.Mesh(new THREE.RingGeometry(.57,.65,56),new THREE.MeshBasicMaterial({color:'#b7cc90',transparent:true,opacity:.65,side:THREE.DoubleSide}));halo.rotation.x=-Math.PI/2;halo.position.y=1.065;g.add(halo);
  const sculpt=new THREE.Group();g.add(sculpt);
  // Two hemispheres, a central fissure, convolutions and a stem form a readable brain silhouette.
  const height=1.94;
  for(const side of [-1,1]){
    sphere(sculpt,.49,side*.34,height,0,pink,[.76,.91,1.13]);
    for(let i=0;i<7;i++){
      const a=-1.10+i*.36;
      sphere(sculpt,.19,side*(.25+.16*Math.cos(a)),height+.31*Math.cos(a),.45*Math.sin(a),pink,[1.12,.85,1.05]);
    }
    for(let i=0;i<4;i++){
      const zz=-.37+i*.245;
      const curve=new THREE.CatmullRomCurve3([
        new THREE.Vector3(side*.16,height+.34,zz-.065),
        new THREE.Vector3(side*.32,height+.43,zz+.035),
        new THREE.Vector3(side*.51,height+.30,zz-.015),
        new THREE.Vector3(side*.66,height+.07,zz+.06),
        new THREE.Vector3(side*.61,height-.17,zz+.025),
      ]);
      sculpt.add(new THREE.Mesh(new THREE.TubeGeometry(curve,22,.018,6,false),fold));
    }
  }
  const fissure=new THREE.CatmullRomCurve3([new THREE.Vector3(0,height-.07,.51),new THREE.Vector3(0,height+.30,.30),new THREE.Vector3(0,height+.43,0),new THREE.Vector3(0,height+.30,-.31),new THREE.Vector3(0,height-.07,-.51)]);
  sculpt.add(new THREE.Mesh(new THREE.TubeGeometry(fissure,32,.022,7,false),material('#a67160')));
  sphere(sculpt,.13,0,height-.42,-.06,pink,[.85,1.7,1]);
  const orbit=new THREE.Group();orbit.position.y=height;g.add(orbit);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.02,.014,8,80),new THREE.MeshBasicMaterial({color:'#98af77',transparent:true,opacity:.85}));ring.rotation.x=Math.PI/2-.25;ring.rotation.y=.25;orbit.add(ring);
  for(const a of [0,2.2,4.3]){const node=sphere(orbit,.055,Math.cos(a)*1.02,Math.sin(a)*.15,Math.sin(a)*.97,new THREE.MeshBasicMaterial({color:'#c0d89c'}));node.castShadow=false;}
  plaque(g,'CÉREBRO',`${info.count} CONHECIMENTOS · V${info.revision}`,1.22,.45,0,.57,.70,{background:'#6b8056'});
  const hit=box(g,2.3,2.85,2.3,0,1.4,0,new THREE.MeshBasicMaterial({visible:false}));hit.userData.member='brain';
  return {g,sculpt,orbit,hit,anchor:new THREE.Vector3(x,3.8,z+.07)};
}
function requestOwner(parent,x,z,targetZ){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=Math.atan2(1.85-x,targetZ-z);parent.add(g);
  rounded(g,1.25,1.13,.09,.20,0,.09,0,material('#d5ddc3'));
  const shirt=material('#b77c55'),skin=material('#d8aa85'),hair=material('#493b2e');
  box(g,.16,.77,.18,-.15,.65,0,mats.dark);box(g,.16,.77,.18,.15,.65,0,mats.dark);
  sphere(g,.39,0,1.26,0,shirt,[.95,1.2,.7]);sphere(g,.30,0,1.96,0,skin,[.94,1.08,.93]);sphere(g,.31,0,2.1,-.035,hair,[1,.56,1]);
  for(const side of [-1,1]){sphere(g,.08,side*.34,1.35,.15,shirt,[1,1,2.2]);sphere(g,.075,side*.26,1.31,.36,skin);sphere(g,.025,side*.11,1.98,.27,mats.dark);}
  const card=box(g,.36,.23,.04,0,1.39,.42,mats.cream);card.rotation.x=-.25;box(g,.24,.025,.045,0,1.41,.45,material('#6c8550'));
  const hit=box(g,1.6,2.6,1.6,0,1.35,0,new THREE.MeshBasicMaterial({visible:false}));hit.userData.member='requester';
  return {g,hit,anchor:new THREE.Vector3(x,2.95,z)};
}
const shortRole=role=>/head/i.test(role)?'Head':/tráfego/i.test(role)?'Tráfego':/editor.*v[ií]deo/i.test(role)?'Editor':/social/i.test(role)?'Social media':role;
function character(parent, member, x, z) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);const accent=material(member.color);
  cylinder(g,.38,.38,.14,0,.52,0,mats.dark);box(g,.7,.72,.15,0,.96,.30,mats.dark);
  const head=new THREE.Group();g.add(head);head.rotation.y=Math.PI;
  cylinder(g,.065,.065,.4,0,.27,0,mats.metal);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;const leg=box(g,.07,.06,.43,Math.sin(a)*.18,.10,Math.cos(a)*.18,mats.dark);leg.rotation.y=a;}
  if(member.type==='robot'){
    sphere(g,.37,0,1.02,0,member.isDirector?accent:mats.white,[.88,1.05,.8]);sphere(head,.43,0,1.58,0,mats.white,[1.02,.9,.94]);
    sphere(head,.32,0,1.6,.28,mats.dark,[1,.49,.48]);const eye=material('#bce9c7',.2);sphere(head,.047,-.12,1.61,.426,eye);sphere(head,.047,.12,1.61,.426,eye);
    sphere(head,.13,-.43,1.57,0,accent,[.6,1,1]);sphere(head,.13,.43,1.57,0,accent,[.6,1,1]);
    cylinder(head,.035,.035,.15,0,2,0,mats.metal);sphere(head,.055,0,2.10,0,accent);
    for(const side of [-1,1]){sphere(g,.11,side*.33,1.05,-.04,accent);const arm=sphere(g,.11,side*.35,.96,-.27,mats.white,[.8,.9,2]);arm.rotation.x=.45;sphere(g,.1,side*.32,.93,-.48,mats.dark);}
    box(g,.22,.07,.03,0,1.07,.30,accent);
  }else{
    sphere(g,.35,0,1.02,0,accent,[1,1.12,.8]);const skin=material(member.id==='clara'?'#cf9c79':'#d8ad8a');sphere(head,.31,0,1.62,0,skin,[.9,1.06,.93]);
    const hair=material(member.id==='clara'?'#5e3f2b':'#3c352e');sphere(head,.32,0,1.78,-.045,hair,[1,.6,1]);
    if(member.id==='clara'){sphere(head,.25,0,1.48,-.16,hair,[1,1.5,.6]);sphere(head,.17,.19,1.48,.07,hair,[.5,1.8,.7]);}
    for(const side of [-1,1]){sphere(head,.055,side*.11,1.62,.28,mats.dark,[.6,.6,.6]);const arm=sphere(g,.11,side*.33,.99,-.24,accent,[1,1,2.3]);arm.rotation.x=.3;sphere(g,.09,side*.33,.93,-.46,skin);}
  }
  box(g,.15,.45,.18,-.16,.44,-.22,mats.dark);box(g,.15,.45,.18,.16,.44,-.22,mats.dark);
  return g;
}
function desk(parent, member, x, z) {
  const g=new THREE.Group();g.position.set(x,0,z);parent.add(g);const accent=material(member.color);
  rounded(g,2.68,1.43,.13,.12,0,1.05,0,member.isDirector?material('#587148'):mats.cream);
  for(const side of [-1,1]){box(g,.09,1,.09,side*1.10,.52,-.48,mats.legs);box(g,.09,1,.09,side*1.10,.52,.43,mats.legs);box(g,.09,.10,1.04,side*1.10,.09,0,mats.legs);}
  const texture=screenTexture(member),screenCtx=texture.image.getContext('2d');
  box(g,1.24,.76,.075,-.12,1.70,-.23,mats.dark);const screen=new THREE.Mesh(new THREE.PlaneGeometry(1.12,.64),new THREE.MeshBasicMaterial({map:texture}));screen.position.set(-.12,1.70,-.187);g.add(screen);
  const active=statusOf(member)==='working';
  const screenLight=box(g,1.18,.025,.025,-.12,2.079,-.183,new THREE.MeshStandardMaterial({color:active?'#8aba66':'#9ca58c',emissive:active?'#7eb45b':'#000000',emissiveIntensity:active ? .6 : 0}));
  const activity=new THREE.Group();activity.position.set(.40,1.43,-.173);g.add(activity);activity.visible=active;
  for(let i=0;i<3;i++){const bar=box(activity,.055,.13,.012,i*.085,0,0,new THREE.MeshBasicMaterial({color:'#9ccf76'}));bar.position.y=.065;}
  box(g,.085,.22,.085,-.12,1.25,-.23,mats.metal);rounded(g,.44,.25,.04,.03,-.12,1.13,-.23,mats.metal);
  rounded(g,.68,.23,.035,.025,-.14,1.14,.36,mats.legs);rounded(g,.15,.21,.04,.04,.45,1.14,.36,mats.metal);
  cylinder(g,.105,.08,.20,.91,1.24,.24,accent);cylinder(g,.082,.082,.012,.91,1.345,.24,mats.dark);
  box(g,.33,.035,.43,-.91,1.15,.17,accent);box(g,.29,.01,.39,-.91,1.175,.17,mats.cream);
  if(member.id==='vico'){box(g,.25,.30,.15,.93,1.31,-.40,mats.dark);cylinder(g,.07,.07,.07,.93,1.31,-.29,mats.metal).rotation.x=Math.PI/2;}
  const char=character(parent,member,x,z+.83);
  const ring=new THREE.Mesh(new THREE.RingGeometry(.47,.52,40),new THREE.MeshBasicMaterial({color:colors[statusOf(member)],transparent:true,opacity:.50,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(x,.10,z+.83);parent.add(ring);
  const hit=box(g,2.8,2.9,2.5,0,1.35,.3,new THREE.MeshBasicMaterial({visible:false}));hit.userData.member=member.id;
  return {g,char,ring,hit,screenCtx,texture,screenLight,activity,anchor:new THREE.Vector3(x,2.72,z+.45),member};
}

export class Office {
  constructor(container, members, {onSelect, avatar, brainInfo={count:0,revision:1}}) {
    this.container=container;this.onSelect=onSelect;this.avatar=avatar;this.brainInfo=brainInfo;this.desks=[];this.t=0;this.disposed=false;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f0f1e8');
    try{this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{this.fallback(members);return;}
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.domElement.setAttribute('aria-label','Escritório 3D do Marketing, com o diretor do time e o cérebro da empresa. Selecione os modelos ou seus cartões para abrir os detalhes.');container.prepend(this.renderer.domElement);
    this.camera=new THREE.OrthographicCamera(-14,14,8,-8,.1,150);this.camera.position.set(17,19,24);this.camera.lookAt(0,0,0);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,.2,0);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.enablePan=false;this.controls.enableZoom=false;this.controls.minPolarAngle=.45;this.controls.maxPolarAngle=1.17;this.controls.minAzimuthAngle=-.8;this.controls.maxAzimuthAngle=1.25;
    this.scene.add(new THREE.HemisphereLight('#fffcf2','#b4bda9',1.8));
    const sun=new THREE.DirectionalLight('#fff7e6',2.8);sun.position.set(-5,14,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-15;sun.shadow.camera.right=15;sun.shadow.camera.top=15;sun.shadow.camera.bottom=-15;sun.shadow.normalBias=.05;sun.shadow.bias=-.0003;sun.shadow.radius=4;this.scene.add(sun);
    const fill=new THREE.DirectionalLight('#e4f1ff',1.1);fill.position.set(8,6,-6);this.scene.add(fill);
    this.world=new THREE.Group();this.scene.add(this.world);
    this.labelLayer=document.createElement('div');this.labelLayer.className='office-labels';container.append(this.labelLayer);
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();
    this.pointerDown=e=>{this.down=[e.clientX,e.clientY];};
    this.pointerUp=e=>{if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>5)return;const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const hit=this.ray.intersectObjects([...this.desks.map(d=>d.hit),...(this.brain?[this.brain.hit]:[]),...(this.requester?[this.requester.hit]:[])])[0];if(hit)this.onSelect(hit.object.userData.member);};
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(container);this.setMembers(members);this.resize();this.animate();
  }
  fallback(members){this.container.classList.add('office-fallback');this.container.innerHTML='<p class="fallback-note">Seu time está aqui. Selecione um integrante para começar.</p>';const grid=document.createElement('div');grid.className='fallback-grid';for(const m of members){const b=document.createElement('button');b.className='fallback-member';b.innerHTML=this.avatar(m)+`<strong>${m.name}</strong><span>${m.role}</span>`;b.onclick=()=>this.onSelect(m.id);grid.append(b);}const brain=document.createElement('button');brain.className='fallback-member';brain.innerHTML='<strong>Cérebro da empresa</strong><span>Regras, referências e aprendizados</span>';brain.onclick=()=>this.onSelect('brain');grid.append(brain);this.container.append(grid);}
  setMembers(members){
    if(!this.renderer){this.fallback(members);return;}
    // Materials for furnishings are shared. Only geometries and generated screen textures are rebuilt.
    this.world.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material?.map)o.material.map.dispose();o.material?.dispose();});this.world.clear();this.labelLayer.replaceChildren();this.desks=[];
    const visible=members.slice(0,20),director=visible.find(m=>m.isDirector),workers=visible.filter(m=>!m.isDirector),rows=Math.max(2,Math.ceil(workers.length/4)),depth=rows*4.1+7;
    this.depth=depth;const centerZ=(rows-1)*4.1/2;
    rounded(this.world,18,depth,.3,.65,0,-.28,0,mats.floor);
    for(let z=-depth/2+.6;z<depth/2;z+=.85)box(this.world,17.9,.008,.014,0,.064,z,material('#d2c8b2'));
    box(this.world,18,3.4,.20,0,1.65,-depth/2+.08,mats.wall);box(this.world,.20,3.4,depth,-8.95,1.65,0,mats.wall);
    box(this.world,17.9,.16,.10,0,.12,-depth/2+.2,mats.cream);box(this.world,.1,.16,depth,-8.8,.12,0,mats.cream);
    // Large studio windows, an inspiration board, plants and a small lounge.
    for(let i=0;i<3;i++){const x=-5.8+i*2.5;box(this.world,2.22,2.1,.12,x,2.05,-depth/2+.23,mats.cream);box(this.world,2.04,1.92,.035,x,2.05,-depth/2+.31,material('#c3d5c3',.2));box(this.world,.055,1.96,.06,x,2.05,-depth/2+.35,mats.cream);box(this.world,2.04,.05,.06,x,2,-depth/2+.35,mats.cream);}
    box(this.world,6.0,1.22,.13,3.7,2.53,-depth/2+.26,mats.wood);
    plaque(this.world,'DIREÇÃO & CONHECIMENTO','O CONTEXTO CONECTA TODO O TIME',5.7,1.04,3.7,2.53,-depth/2+.34,{background:'#e9e9d7',ink:'#5e744a'});
    rounded(this.world,14,rows*4.0,.025,.5,.3,.072,.5,material('#c8d0b6'));
    plant(this.world,-7.7,-depth/2+1.5,1.2);plant(this.world,7.6,-depth/2+1.3,1.25);plant(this.world,7.9,depth/2-1.1,.9);
    const lounge=material('#b5bc91');rounded(this.world,1.1,2.6,.45,.24,-7.8,.25,2.2,lounge);box(this.world,.28,.65,2.7,-8.19,.71,2.2,lounge);for(let i=0;i<2;i++)rounded(this.world,.9,1.17,.15,.12,-7.7,.70,1.58+i*1.27,material('#c6c9a5'));
    cylinder(this.world,.43,.43,.06,-6.95,.64,4.25,mats.wood);cylinder(this.world,.06,.06,.56,-6.95,.32,4.25,mats.legs);
    leadershipArea(this.world,centerZ,Boolean(director));
    this.brain=companyBrain(this.world,6.05,-centerZ-3.48,this.brainInfo);
    this.requester=requestOwner(this.world,-7.15,depth/2-1.48,-centerZ-3.65);
    const userLabel=document.createElement('button');userLabel.className='office-person requester-label';userLabel.dataset.member='requester';userLabel.setAttribute('aria-label','Você, enviar um novo pedido ao diretor');userLabel.title='Você · Enviar um novo pedido ao diretor';userLabel.innerHTML='<span class="requester-initial" aria-hidden="true">F</span><span class="office-person-name">Você</span><span class="office-person-sub">Enviar pedido</span>';userLabel.onclick=()=>this.onSelect('requester');this.labelLayer.append(userLabel);this.requester.label=userLabel;
    for(let i=0;i<visible.length;i++){
      const m=visible[i],slot=workers.indexOf(m),x=m.isDirector?1.85:-5.5+(slot%4)*3.65,z=m.isDirector?-centerZ-3.65:Math.floor(slot/4)*4.1-centerZ+.45;
      const d=desk(this.world,m,x,z);this.desks.push(d);
      const label=document.createElement('button');label.className=`office-person ${statusOf(m)} ${m.isDirector?'director-label':''}`;label.setAttribute('aria-label',`${m.name}, ${m.role}, ${statusLabels[statusOf(m)]}`);label.dataset.member=m.id;label.title=`Abrir ${m.name} · ${m.role}`;
      const name=document.createElement('span');name.className='office-person-name';name.textContent=m.isDirector?'Diretor':shortRole(m.role);const sub=document.createElement('span');sub.className='office-person-sub';sub.textContent=m.isDirector?'Planeja, coordena e revisa':m.name+(m.routineCount?` · ${m.routineCount} ${m.routineCount===1?'rotina':'rotinas'}`:'');
      const av=document.createElement('span');av.className=`office-mini ${m.type}`;av.innerHTML=this.avatar(m);label.append(av,name,sub);if(statusOf(m)==='working'){const work=document.createElement('span');work.className='office-work-indicator';work.setAttribute('aria-hidden','true');work.title='Trabalhando';work.innerHTML='<i></i><i></i><i></i>';label.append(work);}label.onclick=()=>this.onSelect(m.id);this.labelLayer.append(label);d.label=label;
      if(m.isDirector)d.anchor.set(x,3.25,z+.32);
    }
    const brainLabel=document.createElement('button');brainLabel.className='office-person brain-label';brainLabel.dataset.member='brain';brainLabel.setAttribute('aria-label',`Cérebro da empresa, ${this.brainInfo.count} conhecimentos. Abrir cérebro`);
    brainLabel.innerHTML='<span class="brain-label-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5a4 4 0 0 0-7-1 4 4 0 0 0-2 7 4 4 0 0 0 2 7 4 4 0 0 0 7 2m0-15a4 4 0 0 1 7-1 4 4 0 0 1 2 7 4 4 0 0 1-2 7 4 4 0 0 1-7 2V5Zm-5 3 2 2m-4 4h3m8-6-2 2m5 4h-3"/></svg></span>';
    const brainTitle=document.createElement('span');brainTitle.className='office-person-name';brainTitle.textContent='Cérebro';const brainDetail=document.createElement('span');brainDetail.className='office-person-sub';brainDetail.textContent=`${this.brainInfo.count} conhecimentos · regras e memória`;
    brainLabel.append(brainTitle,brainDetail);brainLabel.onclick=()=>this.onSelect('brain');this.labelLayer.append(brainLabel);this.brain.label=brainLabel;
    this.brain.anchor.y=3.05;
    this.flowLayer=new THREE.Group();this.world.add(this.flowLayer);this.routes=[];this.flowHighlights=[];
    this.tourLayer=new THREE.Group();this.world.add(this.tourLayer);
    this.more=members.length>20?members.length-20:0;
    this.baseSize=Math.max(14,depth*1.1);this.resize();
  }
  resize(){if(!this.renderer)return;const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;const aspect=w/h;const size=Math.max(this.baseSize||14,23/Math.max(aspect,.6));this.camera.left=-size*aspect/2;this.camera.right=size*aspect/2;this.camera.top=size/2;this.camera.bottom=-size/2;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h);}
  zoom(delta){if(!this.camera)return;this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom+delta,.65,1.65);this.camera.updateProjectionMatrix();}
  reset(){if(!this.camera)return;this.camera.position.set(17,19,24);this.camera.zoom=1;this.controls.target.set(0,.2,0);this.controls.update();this.resize();}
  select(id){for(const d of this.desks)d.label.classList.toggle('selected',d.member.id===id);}
  focusOn(ids='office',{color='#a4c078'}={}){
    if(!this.renderer)return;ids=Array.isArray(ids)?ids:[ids];
    const points=ids.filter(id=>id!=='office').map(id=>this.nodePoint(id)).filter(Boolean);
    this.tourLayer.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.tourLayer.clear();
    this.labelLayer.querySelectorAll('.office-person').forEach(l=>{l.classList.toggle('tour-target',ids.includes(l.dataset.member));l.classList.toggle('tour-muted',points.length>0&&!ids.includes(l.dataset.member));});
    this.controls.enabled=false;
    if(!points.length){this.cameraGoal={target:new THREE.Vector3(0,.2,0),position:new THREE.Vector3(17,19,24),zoom:1};return;}
    const center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length);center.y=1.25;
    let distance=0;for(const a of points)for(const b of points)distance=Math.max(distance,a.distanceTo(b));
    const height=this.camera.top-this.camera.bottom,width=this.camera.right-this.camera.left;
    const zoom=points.length===1?3.2:THREE.MathUtils.clamp(Math.min(height/(4+distance*.8),width/(5+distance)),1,2.8);
    this.cameraGoal={target:center,position:center.clone().add(new THREE.Vector3(17,18.8,24)),zoom};
    for(const p of points){const ring=new THREE.Mesh(new THREE.RingGeometry(.71,.82,48),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(p.x,.26,p.z);this.tourLayer.add(ring);}
    if(points.length===2){const middle=points[0].clone().add(points[1]).multiplyScalar(.5);middle.y=Math.max(points[0].y,points[1].y)+.9;const curve=new THREE.QuadraticBezierCurve3(points[0],middle,points[1]);this.tourLayer.add(new THREE.Mesh(new THREE.TubeGeometry(curve,36,.018,6),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.65})));}
  }
  clearFocus(){if(!this.renderer)return;this.focusOn('office');this.controls.enabled=true;this.labelLayer.querySelectorAll('.office-person').forEach(l=>l.classList.remove('tour-target','tour-muted'));}
  animateFocus(reduce){if(!this.cameraGoal)return;const goal=this.cameraGoal;if(goal.startedAt===undefined){goal.startedAt=Date.now();goal.fromPosition=this.camera.position.clone();goal.fromTarget=this.controls.target.clone();goal.fromZoom=this.camera.zoom;}const progress=reduce?1:THREE.MathUtils.clamp((Date.now()-goal.startedAt)/750,0,1),ease=1-Math.pow(1-progress,3);this.camera.position.lerpVectors(goal.fromPosition,goal.position,ease);this.controls.target.lerpVectors(goal.fromTarget,goal.target,ease);this.camera.zoom=THREE.MathUtils.lerp(goal.fromZoom,goal.zoom,ease);this.camera.updateProjectionMatrix();if(progress===1)this.cameraGoal=null;}
  nodePoint(id){if(id==='requester')return this.requester?.g.position.clone().add(new THREE.Vector3(0,1.8,0));if(id==='brain')return this.brain?.g.position.clone().add(new THREE.Vector3(0,2.0,0));const d=this.desks.find(d=>d.member.id===id);return d?.g.position.clone().add(new THREE.Vector3(0,2.15,.15));}
  setJourney(snapshot){
    if(!this.renderer||!this.flowLayer)return;this.journey=snapshot;
    this.flowLayer.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});this.flowLayer.clear();this.routes=[];this.flowHighlights=[];this.thoughts=null;this.flowNote?.remove();this.flowNote=null;
    this.labelLayer.querySelectorAll('.office-person').forEach(l=>{l.classList.remove('journey-focused','journey-working','journey-waiting','journey-received','journey-pending');delete l.dataset.journeyStatus;});
    const contextual=Boolean(snapshot&&['distributing','running'].includes(snapshot.phase));
    for(const d of this.desks){
      const task=contextual?snapshot.tasks.find(t=>t.memberId===d.member.id):null;
      const status=contextual&&!d.member.isDirector?(task?(task.receivedAt?task.status:'dispatching'):'available'):statusOf(d.member);
      d.visualWork=status==='working';d.activity.visible=d.visualWork;d.label.classList.toggle('working',d.visualWork);d.label.classList.toggle('journey-pending',status==='dispatching');
      d.label.classList.toggle('blocked',status==='blocked');d.label.classList.toggle('assigned',status==='assigned');
      d.ring.material.color.set(colors[status]||'#a9b59a');
      const indicator=d.label.querySelector('.office-work-indicator');if(indicator)indicator.style.display=d.visualWork?'flex':'none';
      if(d.visualWork&&!indicator){const work=document.createElement('span');work.className='office-work-indicator';work.setAttribute('aria-hidden','true');work.innerHTML='<i></i><i></i><i></i>';d.label.append(work);}
      d.screenLight.material.color.set(d.visualWork?'#8aba66':status==='blocked'?'#c8a564':'#a2ae92');d.screenLight.material.emissive.set(d.visualWork?'#7eb45b':'#000000');d.screenLight.material.emissiveIntensity=d.visualWork ? .6 : 0;
      if(contextual){const c=d.screenCtx;c.fillStyle=status==='blocked'?'#f3ecda':'#edf2e4';c.fillRect(48,237,336,19);c.fillStyle=status==='blocked'?'#a58b53':'#65794f';c.font='bold 8px sans-serif';c.fillText(d.visualWork?'TRABALHANDO':status==='blocked'?'AGUARDANDO ETAPA':status==='assigned'?'TAREFA RECEBIDA':status==='dispatching'?'TAREFA A CAMINHO':'DISPONÍVEL',58,250);d.texture.needsUpdate=true;}
      if(contextual&&!d.member.isDirector){const description=task?(task.receivedAt?statusLabels[status]||status:'Tarefa a caminho'):'Fora deste pedido';d.label.setAttribute('aria-label',`${d.member.name}, ${d.member.role}, Neste pedido: ${description}`);d.label.title=`${d.member.name} · ${description}`;}
      else{d.label.setAttribute('aria-label',`${d.member.name}, ${d.member.role}, ${statusLabels[status]}`);d.label.title=`Abrir ${d.member.name} · ${d.member.role}`;}
    }
    if(!snapshot)return;
    const highlight=(id,color='#9dbd72')=>{const p=this.nodePoint(id);if(!p)return;const label=this.labelLayer.querySelector(`[data-member="${id}"]`);label?.classList.add('journey-focused');const ring=new THREE.Mesh(new THREE.RingGeometry(id==='brain' ? .92 : .62,id==='brain' ? 1.08 : .75,48),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.48,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(p.x,.24,p.z);this.flowLayer.add(ring);this.flowHighlights.push(ring);};
    const route=(from,to,color='#91b064',reverse=false)=>{const a=this.nodePoint(from),b=this.nodePoint(to);if(!a||!b)return;const mid=a.clone().add(b).multiplyScalar(.5);mid.y=Math.max(a.y,b.y)+2.0;const curve=new THREE.QuadraticBezierCurve3(a,mid,b);const line=new THREE.Mesh(new THREE.TubeGeometry(curve,40,.019,6,false),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.55}));this.flowLayer.add(line);const packet=new THREE.Group();box(packet,.42,.30,.04,0,0,0,new THREE.MeshBasicMaterial({color:'#617f45'}));box(packet,.29,.035,.045,0,.04,.025,new THREE.MeshBasicMaterial({color:'#f1f8df'}));box(packet,.19,.025,.045,-.05,-.045,.025,new THREE.MeshBasicMaterial({color:'#d3e4b8'}));this.flowLayer.add(packet);this.routes.push({curve,packet,reverse});};
    const phase=snapshot.phase;let note='',noteAt='director';
    if(phase==='sending'){highlight('requester');route('requester','director');note='Seu pedido está chegando';}
    else if(phase==='received'){highlight('director');note='Pedido recebido';}
    else if(phase==='consulting'){highlight('director');highlight('brain','#c4a684');route('director','brain','#ad9871',true);note='Consultando regras';noteAt='brain';}
    else if(phase==='planning'){highlight('director');note='Preparando o plano…';const p=this.nodePoint('director');if(p){this.thoughts=new THREE.Group();this.thoughts.position.copy(p).add(new THREE.Vector3(.72,.5,.0));for(let i=0;i<3;i++)sphere(this.thoughts,.075,i*.20,.06,0,new THREE.MeshBasicMaterial({color:'#a4be7e'}));this.flowLayer.add(this.thoughts);}}
    else if(phase==='awaiting_approval'){highlight('director');highlight('requester');note='Plano pronto · sua aprovação';}
    else if(phase==='distributing'){highlight('director');if(snapshot.focusMember){highlight(snapshot.focusMember);if(!snapshot.guideHolding)route('director',snapshot.focusMember);noteAt=snapshot.focusMember;note=snapshot.guideHolding?'Tarefa recebida':'Recebendo nova tarefa';}}
    else if(phase==='running'&&snapshot.guideHolding&&snapshot.focusMember){highlight(snapshot.focusMember);noteAt=snapshot.focusMember;note='Tarefa recebida';}
    for(const task of snapshot.tasks){const label=this.labelLayer.querySelector(`[data-member="${task.memberId}"]`);if(!label)continue;if(task.receivedAt){label.classList.add(task.status==='working'?'journey-working':task.status==='blocked'?'journey-waiting':'journey-received');label.dataset.journeyStatus=task.status;label.title=`${task.name} · Neste pedido: ${statusLabels[task.status]||task.status}`;}}
    if(note){const p=this.nodePoint(noteAt);if(p){this.flowNote=document.createElement('div');this.flowNote.className=`office-flow-note ${phase}`;this.flowNote.setAttribute('aria-hidden','true');this.flowNote.innerHTML='<span class="flow-note-dot"></span>';const text=document.createElement('span');text.textContent=note;this.flowNote.append(text);this.labelLayer.append(this.flowNote);this.flowNoteAnchor=p.add(new THREE.Vector3(0,1.95,0));}}
  }
  animateJourney(reduce){
    const s=this.journey;if(!s)return;
    const progress=Math.max(0,Math.min(1,((s.pausedAt||Date.now())-s.enteredAt)/(s.guideDuration||stageDurations[s.phase]||1)));
    for(const r of this.routes){const t=reduce ? .5 : r.reverse ?(progress<.5?progress*2:(1-progress)*2):progress;r.packet.position.copy(r.curve.getPointAt(t));r.packet.quaternion.copy(this.camera.quaternion);}
    for(const ring of this.flowHighlights)ring.material.opacity=reduce||s.pausedAt ? .48 : .3+(Math.sin(this.t*4)+1)*.15;
    if(this.thoughts&&!reduce&&!s.pausedAt)this.thoughts.children.forEach((dot,i)=>{dot.position.y=.06+Math.sin(this.t*5+i)*.06;});
    if(this.flowNote)this.positionLabel(this.flowNoteAnchor,this.flowNote);
  }
  positionLabel(anchor,label){v.copy(anchor).project(this.camera);label.style.left=`${(v.x*.5+.5)*this.container.clientWidth}px`;label.style.top=`${(-v.y*.5+.5)*this.container.clientHeight}px`;label.style.visibility=Math.abs(v.x)>1.1||Math.abs(v.y)>1.1?'hidden':'visible';}
  animate(){if(this.disposed)return;this.frame=requestAnimationFrame(()=>this.animate());this.t+=.015;const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches,updateScreen=!reduce&&(!this.lastScreenTick||this.t-this.lastScreenTick>.11);if(updateScreen)this.lastScreenTick=this.t;this.animateFocus(reduce);this.controls.update();this.camera.updateMatrixWorld();for(const [i,d] of this.desks.entries()){
    if(d.visualWork ?? (statusOf(d.member)==='working')){
      if(!reduce){d.char.rotation.y=Math.sin(this.t+i)*.045;d.char.position.y=Math.sin(this.t*1.4+i)*.012;d.screenLight.material.emissiveIntensity=.35+(Math.sin(this.t*3+i)+1)*.35;d.activity.children.forEach((bar,j)=>{bar.scale.y=.35+(Math.sin(this.t*6+i+j*1.4)+1)*.4;bar.position.y=.065*bar.scale.y;});}
      if(updateScreen){const c=d.screenCtx;c.fillStyle='#eaf2df';c.fillRect(48,237,336,19);c.fillStyle='#52733d';c.font='bold 8px sans-serif';c.fillText('TRABALHANDO',58,250);c.fillStyle='#d2e3bf';c.fillRect(145,244,188,5);c.fillStyle='#79a452';const x=145+(Math.sin(this.t*2+i)+1)*73;c.fillRect(x,244,42,5);d.texture.needsUpdate=true;}
    }
    this.positionLabel(d.anchor,d.label);
  }if(this.brain){if(!reduce){this.brain.sculpt.position.y=Math.sin(this.t)*.045;this.brain.orbit.rotation.y=this.t*.15;}this.positionLabel(this.brain.anchor,this.brain.label);}if(this.requester)this.positionLabel(this.requester.anchor,this.requester.label);this.animateJourney(reduce);this.renderer.render(this.scene,this.camera);}
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.observer?.disconnect();this.controls?.dispose();this.scene?.traverse(o=>{o.geometry?.dispose();if(o.material?.map)o.material.map.dispose();o.material?.dispose();});this.renderer?.dispose();}
}
