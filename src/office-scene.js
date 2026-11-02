import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// O escritório funcional recebe somente os agentes criados nesta instalação.
export class OfficeScene {
  constructor(container,{agents=[],onSelect=()=>{}}={}) {
    this.container = container;
    this.agents=agents;this.onSelect=onSelect;
    this.disposed = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f0f2e9');
    this.materials = new Map();
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'low-power' });
    } catch {
      this.showFallback();
      return;
    }
    const canvas = this.renderer.domElement;
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label',agents.length?'Escritório 3D com Lia, agente de social media, em sua estação de trabalho.':'Escritório 3D com seis mesas e cadeiras, janelas e plantas.');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.append(canvas);

    this.camera = new THREE.OrthographicCamera(-12,12,9,-9,.1,120);
    this.camera.position.set(17,18,23);
    this.controls = new OrbitControls(this.camera,canvas);
    this.controls.target.set(0,1.2,0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .1;
    this.controls.enablePan = false;
    this.controls.minZoom = .7;
    this.controls.maxZoom = 2;
    this.controls.minPolarAngle = .45;
    this.controls.maxPolarAngle = Math.PI / 2.45;
    this.controls.minAzimuthAngle = .12;
    this.controls.maxAzimuthAngle = Math.PI / 2 - .12;
    this.controls.update();
    this.scene.add(new THREE.HemisphereLight('#fffef3','#b5bfa4',3));
    const sun = new THREE.DirectionalLight('#fff8e5',4.2);
    sun.position.set(-5,15,8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048,2048);
    Object.assign(sun.shadow.camera,{left:-15,right:15,top:15,bottom:-15,near:1,far:45});
    sun.shadow.normalBias = .025;
    sun.shadow.bias = -.00025;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#eef4e6',1.2);
    fill.position.set(9,8,-4);
    this.scene.add(fill);
    this.room = new THREE.Group();
    this.scene.add(this.room);
    this.buildRoom();
    if(agents.some(a=>a.id==='lia'))this.buildLia(agents.find(a=>a.id==='lia'));
    this.bounds = new THREE.Box3().setFromObject(this.room);
    this.controls.target.copy(this.bounds.getCenter(new THREE.Vector3()));
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(17,18,23));
    this.controls.update();
    this.requestRender = () => {
      if (this.disposed || this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        if (this.disposed) return;
        this.controls.update();
        this.renderer.render(this.scene,this.camera);
        this.positionAgentLabel();
      });
    };
    this.controls.addEventListener('change',this.requestRender);
    this.raycaster=new THREE.Raycaster();
    this.onPointerDown=e=>{this.pointerStart={x:e.clientX,y:e.clientY};};
    this.onPointerUp=e=>{
      if(!this.lia||!this.pointerStart||Math.hypot(e.clientX-this.pointerStart.x,e.clientY-this.pointerStart.y)>6)return;
      const rect=canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),this.camera);
      if(this.raycaster.intersectObject(this.lia,true).length){this.focusAgent();this.onSelect('lia');}
    };
    canvas.addEventListener('pointerdown',this.onPointerDown);canvas.addEventListener('pointerup',this.onPointerUp);
    this.onContextLost = event => { event.preventDefault(); this.showFallback(); };
    canvas.addEventListener('webglcontextlost',this.onContextLost);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  material(color, roughness=.8) {
    const key = color + ':' + roughness;
    if (!this.materials.has(key)) this.materials.set(key,new THREE.MeshStandardMaterial({color,roughness}));
    return this.materials.get(key);
  }
  mesh(parent, geometry, color, x,y,z, roughness) {
    const mesh = new THREE.Mesh(geometry,this.material(color,roughness));
    mesh.position.set(x,y,z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  box(parent,w,h,d,x,y,z,color) { return this.mesh(parent,new THREE.BoxGeometry(w,h,d),color,x,y,z); }
  cylinder(parent,top,bottom,h,x,y,z,color) { return this.mesh(parent,new THREE.CylinderGeometry(top,bottom,h,24),color,x,y,z); }
  sphere(parent,r,x,y,z,color,scale=[1,1,1]) {
    const mesh = this.mesh(parent,new THREE.SphereGeometry(r,18,12),color,x,y,z);
    mesh.scale.set(...scale);
    return mesh;
  }
  buildLia(agent){
    const g=new THREE.Group();g.position.set(.2,0,3.13);this.room.add(g);this.lia=g;
    const white='#f4f6ef',dark='#34483c',accent=agent.color;
    // Corpo sentado, fones e rosto acolhedor; braços voltados ao teclado.
    this.sphere(g,.36,0,1.09,0,white,[.97,1.12,.78]);
    this.cylinder(g,.11,.13,.18,0,1.47,0,'#7d9277');
    this.sphere(g,.45,0,1.90,0,white,[1.07,.92,.95]);
    this.sphere(g,.34,0,1.91,.29,dark,[1.08,.55,.5]);
    for(const side of [-1,1]){
      this.sphere(g,.055,side*.135,1.94,.445,'#d8edb2',[.85,1.18,.5]);
      this.sphere(g,.14,side*.46,1.88,0,accent,[.65,1,1]);
      this.sphere(g,.115,side*.34,1.17,-.04,accent);
      const arm=this.sphere(g,.115,side*.35,1.08,-.26,white,[.85,.92,2]);arm.rotation.x=.30;
      this.sphere(g,.10,side*.33,1.02,-.49,dark);
      this.box(g,.17,.40,.19,side*.16,.46,-.15,dark);
      this.rounded(g,.21,.34,.12,.06,side*.16,.25,-.22,accent);
    }
    this.box(g,.16,.025,.025,0,1.81,.455,'#a4bc8a');
    this.cylinder(g,.028,.028,.17,0,2.37,0,'#829477');this.sphere(g,.065,0,2.49,0,accent);
    this.rounded(g,.21,.035,.08,.02,0,1.12,.29,accent);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.60,.65,48),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.65,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.12;g.add(ring);this.liaRing=ring;
    const label=document.createElement('button');label.className='office-agent-label';label.setAttribute('aria-label','Abrir Lia, agente de social media');
    label.innerHTML='<span class="office-agent-label-name">Lia <i></i></span><span class="office-agent-label-role">Social media</span>';
    label.onclick=()=>{this.focusAgent();this.onSelect('lia');};this.container.append(label);this.agentLabel=label;
    this.agentAnchor=new THREE.Vector3(.2,3.1,3.13);
    // Um quadro editorial decorativo identifica a estação, sem simular tarefas.
    for(let row=0;row<2;row++)for(let col=0;col<3;col++)this.box(this.room,.27,.19,.015,-.36+col*.36,1.68+row*.28,1.82,['#b6cba2','#e3cca8','#cfdbbd'][(row+col)%3]);
  }
  positionAgentLabel(){
    if(!this.agentLabel)return;
    const p=this.agentAnchor.clone().project(this.camera);
    this.agentLabel.style.left=`${(p.x*.5+.5)*this.container.clientWidth}px`;
    this.agentLabel.style.top=`${(-p.y*.5+.5)*this.container.clientHeight}px`;
    this.agentLabel.hidden=Math.abs(p.x)>1||Math.abs(p.y)>1;
  }
  setAgentStatus(status){
    if(!this.lia)return;
    const working=status==='working';this.agentLabel.dataset.status=status;
    this.agentLabel.querySelector('.office-agent-label-role').textContent=working?'Preparando sua entrega…':'Social media';
    this.container.closest('main')?.querySelector('.office-team-dot')?.classList.toggle('working',working);
    this.liaRing.material.color.set(working?'#b99a58':'#9baf83');this.requestRender();
  }
  focusAgent(){
    if(!this.lia||!this.renderer)return;
    this.controls.target.set(.2,1.2,2.0);this.camera.position.copy(this.controls.target).add(new THREE.Vector3(17,18,23));this.camera.zoom=1.35;
    this.camera.updateProjectionMatrix();this.controls.update();this.requestRender();
  }
  rounded(parent,w,d,h,r,x,y,z,color) {
    const shape = new THREE.Shape(),a=-w/2,b=-d/2;
    shape.moveTo(a+r,b);shape.lineTo(a+w-r,b);shape.quadraticCurveTo(a+w,b,a+w,b+r);
    shape.lineTo(a+w,b+d-r);shape.quadraticCurveTo(a+w,b+d,a+w-r,b+d);
    shape.lineTo(a+r,b+d);shape.quadraticCurveTo(a,b+d,a,b+d-r);shape.lineTo(a,b+r);shape.quadraticCurveTo(a,b,a+r,b);
    const geo = new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:true,bevelSize:.025,bevelThickness:.025,bevelSegments:2,curveSegments:6,steps:1});
    geo.rotateX(-Math.PI/2);
    return this.mesh(parent,geo,color,x,y,z);
  }

  buildRoom() {
    const g=this.room;
    this.rounded(g,15.2,11.8,.22,.32,0,-.25,0,'#d4cfba');
    this.rounded(g,15.05,11.65,.055,.27,0,0,0,'#e9e1cf');
    // Tábuas claras, com juntas discretas.
    for(let i=0;i<28;i++) this.box(g,14.9,.008,.014,0,.065,-5.55+i*.41,'#d8d2c2');
    for(let i=0;i<7;i++) for(let j=0;j<7;j++) this.box(g,.014,.008,.40,-6.4+j*2.12+(i%2?1.06:0),.067,-5.54+i*1.64,'#d8d2c2');
    this.box(g,15.08,3.45,.16,0,1.78,-5.7,'#dfe3d5');
    this.box(g,.16,3.45,11.5,-7.45,1.78,0,'#e4e5d8');
    this.box(g,14.9,.13,.1,0,.16,-5.56,'#f2f2e9');
    this.box(g,.1,.13,11.3,-7.32,.16,0,'#f2f2e9');
    this.box(g,15.12,.055,.21,0,3.53,-5.7,'#eff0e7');
    this.box(g,.21,.055,11.5,-7.45,3.53,0,'#eff0e7');
    for(const x of [-4.4,-1.25,1.9]) this.window(x,-5.59);
    this.rounded(g,11.8,7.5,.025,.24,.4,.1,.8,'#d5ddc8');
    // Seis estações; apenas a Lia ocupa uma delas nesta etapa.
    for(const [row,z] of [-1.45,2.05].entries()) for(const [column,x] of [-3.7,.2,4.1].entries()) this.desk(x,z,(row+column)%2===0?'#859775':'#9da98b');
    this.plant(-6.45,-4.5,1.08);
    this.plant(6.25,-4.4,1.12);
    this.plant(6.3,4.8,.72);
    this.shelf();
    // Quadro de cortiça vazio para o futuro espaço da equipe.
    this.box(g,.07,1.15,2.1,-7.32,2.05,.5,'#b3b89e');
    this.box(g,.08,1.03,1.97,-7.26,2.05,.5,'#d7c6a4');
  }
  window(x,z) {
    const g=this.room;
    this.box(g,2.6,1.7,.055,x,2.15,z,'#f3f4ec');
    this.box(g,2.39,1.49,.055,x,2.15,z+.035,'#b9c9b6');
    this.box(g,.055,1.51,.055,x,2.15,z+.075,'#eef0e5');
    this.box(g,2.39,.045,.055,x,2.15,z+.075,'#eef0e5');
    this.box(g,2.76,.07,.24,x,1.28,z+.07,'#f0f0e7');
  }
  desk(x,z,accent) {
    const g=new THREE.Group();g.position.set(x,0,z);this.room.add(g);
    this.rounded(g,2.8,1.52,.13,.12,0,1.12,0,'#f2f1e6');
    for(const side of [-1,1]) {
      for(const zz of [-.5,.49]) this.box(g,.095,1.05,.095,side*1.12,.57,zz,'#a7b2a1');
      this.box(g,.10,.07,1.13,side*1.12,.12,0,'#a7b2a1');
    }
    this.box(g,1.31,.83,.08,-.1,1.85,-.29,'#405047');
    this.box(g,1.18,.7,.012,-.1,1.85,-.242,'#52665b');
    this.box(g,.075,.22,.075,-.1,1.34,-.29,'#829489');
    this.rounded(g,.47,.29,.04,.04,-.1,1.20,-.29,'#9ca89a');
    this.rounded(g,.76,.25,.025,.035,-.1,1.21,.40,'#c5cdbb');
    for(let i=0;i<3;i++) this.box(g,.63,.005,.016,-.1,1.242,.33+i*.06,'#aab9a0');
    this.rounded(g,.14,.22,.035,.045,.52,1.21,.41,'#a9b9a2');
    this.box(g,.35,.018,.45,-.96,1.21,.25,'#d4d4bd');
    this.box(g,.31,.012,.40,-.96,1.23,.25,'#ececdc');
    this.chair(x,z+1.32,accent);
  }
  chair(x,z,accent) {
    const g=new THREE.Group();g.position.set(x,0,z);this.room.add(g);
    this.cylinder(g,.055,.055,.53,0,.38,0,'#6b7c6a');
    for(let i=0;i<5;i++) {
      const a=i*Math.PI*2/5;
      const leg=this.box(g,.065,.055,.5,Math.sin(a)*.24,.13,Math.cos(a)*.24,'#687967');leg.rotation.y=a;
      const wheel=this.sphere(g,.065,Math.sin(a)*.46,.09,Math.cos(a)*.46,'#526650',[.8,1,1]);wheel.castShadow=false;
    }
    this.rounded(g,.79,.69,.14,.17,0,.64,0,accent);
    this.box(g,.63,.56,.105,0,1.04,.34,'#5f745a');
    this.box(g,.60,.49,.075,0,1.07,.28,accent);
    for(const side of [-1,1]) {
      this.box(g,.045,.3,.045,side*.41,.83,.08,'#6e8167');
      this.rounded(g,.1,.47,.045,.04,side*.41,.99,.015,'#6d8263');
    }
  }
  plant(x,z,scale) {
    const g=new THREE.Group();g.position.set(x,.09,z);g.scale.setScalar(scale);this.room.add(g);
    this.cylinder(g,.34,.26,.57,0,.29,0,'#bf9471');
    this.cylinder(g,.32,.32,.03,0,.59,0,'#667d4c');
    this.cylinder(g,.027,.027,1,0,1.05,0,'#78895d');
    for(let i=0;i<11;i++) { const a=i*2.4; const leaf=this.sphere(g,.34,Math.sin(a)*.3,1.05+i*.06,Math.cos(a)*.28,['#7b955f','#97aa7a','#69844f'][i%3],[.64,1.2,.72]);leaf.rotation.z=Math.sin(a)*.55;leaf.rotation.x=Math.cos(a)*.55; }
  }
  shelf() {
    const g=new THREE.Group();g.position.set(-6.8,0,-1.7);this.room.add(g);
    this.box(g,.65,1.6,1.8,0,.87,0,'#b7bfa4');
    for(const y of [.22,.85,1.48]) this.box(g,.69,.065,1.85,.035,y,0,'#e6e7d7');
    for(let i=0;i<5;i++) this.box(g,.4,.44,.12,.12,.47,-.6+i*.16,['#8a9d73','#d7c4a6','#b1bea0'][i%3]);
    this.box(g,.42,.30,.52,.12,1.05,.40,'#d8d3bb');
    this.cylinder(g,.14,.1,.22,.1,1.65,-.37,'#bd9775');
    this.sphere(g,.18,.1,1.93,-.37,'#8ba172',[.7,1.2,.8]);
  }
  resize() {
    if(!this.renderer || this.disposed)return;
    const {clientWidth:width,clientHeight:height}=this.container;
    if(!width||!height)return;
    const aspect=width/height;
    // Enquadra o ambiente inteiro também em telas estreitas.
    const target=this.controls.target.clone(),position=target.clone().add(new THREE.Vector3(17,18,23));
    const framingCamera=this.camera.clone();framingCamera.position.copy(position);framingCamera.lookAt(target);framingCamera.updateMatrixWorld();
    let maxX=0,maxY=0;
    for(const x of [this.bounds.min.x,this.bounds.max.x])for(const y of [this.bounds.min.y,this.bounds.max.y])for(const z of [this.bounds.min.z,this.bounds.max.z]) {
      const p=new THREE.Vector3(x,y,z).applyMatrix4(framingCamera.matrixWorldInverse);maxX=Math.max(maxX,Math.abs(p.x));maxY=Math.max(maxY,Math.abs(p.y));
    }
    const halfHeight=Math.max(maxY,maxX/aspect)*1.12;
    Object.assign(this.camera,{left:-halfHeight*aspect,right:halfHeight*aspect,top:halfHeight,bottom:-halfHeight});
    this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);this.requestRender();
  }
  zoom(delta) { if(!this.renderer)return;this.camera.zoom=THREE.MathUtils.clamp(this.camera.zoom+delta,.7,2);this.camera.updateProjectionMatrix();this.requestRender(); }
  reset() { if(!this.renderer)return;this.camera.zoom=1;this.controls.target.copy(this.bounds.getCenter(new THREE.Vector3()));this.camera.position.copy(this.controls.target).add(new THREE.Vector3(17,18,23));this.controls.update();this.camera.updateProjectionMatrix();this.requestRender(); }
  showFallback() {
    this.container.querySelector('.office-unavailable')?.remove();
    const panel=document.createElement('div');panel.className='office-unavailable';panel.setAttribute('role','status');
    const title=document.createElement('strong');title.textContent='Não foi possível abrir o escritório em 3D.';
    const hint=document.createElement('p');hint.textContent='Tente atualizar a página ou abrir em outro navegador.';
    const button=document.createElement('button');button.textContent='Atualizar página';button.onclick=()=>location.reload();
    panel.append(title,hint,button);this.container.append(panel);this.container.dispatchEvent(new Event('office-unavailable'));
  }
  dispose() {
    this.disposed=true;cancelAnimationFrame(this.frame);this.observer?.disconnect();this.controls?.dispose();
    this.renderer?.domElement.removeEventListener('webglcontextlost',this.onContextLost);
    this.renderer?.domElement.removeEventListener('pointerdown',this.onPointerDown);this.renderer?.domElement.removeEventListener('pointerup',this.onPointerUp);this.agentLabel?.remove();
    const geometries=new Set();this.scene.traverse(mesh=>{if(mesh.geometry)geometries.add(mesh.geometry);});
    geometries.forEach(g=>g.dispose());this.liaRing?.material.dispose();this.materials.forEach(m=>m.dispose());this.renderer?.dispose();
  }
}
