/* =====================================================================
   HALO RING COLLECTION — ALL 26
   KAN community mod for HUMAN SPACE PROGRAM · author: benjeep10

   Entry point:   HaloRingMod.init(window.HSP_EXT)
   Removal:       HaloRingMod.shutdown()   (or just delete the files)

   This file contains no HSP internals.  It talks only to the generic
   HSP_EXT hooks, which either ship with HSP or are provided by the shim.
   ===================================================================== */
(function(global){
"use strict";

const MANIFEST={
  id:"halo-ring-collection",
  name:"Halo Ring Collection — All 26",
  version:"0.1.0",
  author:"benjeep10",
  requires:{extApi:1}
};

const RING_DEFAULTS={
  radius:5.0e6, width:3.2e5, thickness:1.4e4, wallHeight:9.0e4,
  targetGravity:9.2, atmosphereHeight:2.6e4,
  activationRange:1.4e6, visualRange:8.0e7,
  terrainSeed:1, theme:"verdant", implemented:false
};

const HaloRingMod={
  manifest:MANIFEST,
  rings:[],
  state:{ext:null,THREE:null,group:null,meshes:{},active:null,started:false},

  /* ---- data ------------------------------------------------------- */
  defineRing(cfg){
    const P=global.HaloPhysics;
    const r=Object.assign({},RING_DEFAULTS,cfg);
    r.spin=P.spinFor(r.radius,r.targetGravity);
    r.floorSpeed=r.spin*r.radius;
    r.orbit=r.orbit||{parent:"kerfin",a:2.4e7,phase:0,inc:0.2};
    this.rings.push(r);
    return r;
  },

  /* Load from data/rings.json when fetch is available; otherwise fall back
     to the same definitions inline, so the mod works from a file:// page. */
  loadRings(json){
    this.rings.length=0;
    const d=json||HaloRingMod.DEFAULT_DATA;
    const defaults=d.defaults||{};
    (d.rings||[]).forEach(r=>this.defineRing(Object.assign({},defaults,r)));
    const g=d.generated;
    if(g){
      const themes=g.themes||["verdant"];
      for(let i=g.startIndex;i<g.startIndex+g.count;i++){
        const id="KRI-"+String(i).padStart(2,"0");
        this.defineRing(Object.assign({},defaults,{
          id:id, displayName:id, implemented:false,
          radius:g.radiusBase+((i*7919)%22)*g.radiusStep,
          targetGravity:7.4+((i*104729)%28)/10,
          terrainSeed:1100+i,
          theme:themes[i%themes.length],
          orbit:{parent:"kerfin",a:2.4e7+i*3.1e6,
                 phase:((i*0.6180339887)%1)*6.283, inc:0.10+((i*13)%40)/100}
        }));
      }
    }
    return this.rings;
  },

  ringById(id){ return this.rings.find(r=>r.id===id)||null; },

  /* Ring centre in world space, parented to a body from HSP's own registry
     so the ring rides along with Kerfin instead of drifting in the Sun frame. */
  ringCentre(ring,t){
    const THREE=this.state.THREE;
    const c=new THREE.Vector3();
    if(global.hspBodyPos&&ring.orbit&&ring.orbit.parent){
      try{ c.copy(global.hspBodyPos(ring.orbit.parent,t)); }catch(e){}
    }
    const a=ring.orbit.a, ph=ring.orbit.phase, inc=ring.orbit.inc;
    c.x+=Math.cos(ph)*a;
    c.z+=Math.sin(ph)*a*Math.cos(inc);
    c.y+=Math.sin(ph)*a*Math.sin(inc);
    return c;
  },

  /* ---- lifecycle -------------------------------------------------- */
  init(EXT,ringData){
    const S=this.state;
    if(S.started) return this;
    if(!EXT||!EXT.registerGravityProvider)
      throw new Error("HaloRingMod.init: HSP_EXT missing — load src/hsp-ext-shim.js first");
    if(typeof global.THREE==="undefined")
      throw new Error("HaloRingMod.init: THREE not available");
    if(!global.HaloPhysics||!global.HaloRenderer)
      throw new Error("HaloRingMod.init: load halo-ring-physics.js and halo-ring-renderer.js first");
    S.ext=EXT; S.THREE=global.THREE;
    EXT.registerMod(MANIFEST);
    this.loadRings(ringData);

    this.rings.forEach(r=>EXT.registerMegastructure({
      id:r.id, name:r.displayName||r.id, kind:"halo-ring",
      mod:MANIFEST.id, implemented:!!r.implemented, radius:r.radius,
      centre:t=>this.ringCentre(r,t)
    }));

    S.gravityFn=EXT.registerGravityProvider((pos,t)=>{
      const THREE=S.THREE, P=global.HaloPhysics;
      for(let i=0;i<this.rings.length;i++){
        const r=this.rings[i];
        if(!r.implemented) continue;
        r._centre=this.ringCentre(r,t);
        const g=P.gravity(THREE,r,pos);
        if(g){ S.active=r.id; return g; }
      }
      S.active=null;
      return null;
    });

    S.frameFn=EXT.registerFrameHook(ctx=>{
      const THREE=S.THREE, R=global.HaloRenderer;
      if(!ctx.scene) return;
      if(!S.group){ S.group=new THREE.Group(); S.group.name="haloRings"; ctx.scene.add(S.group); }
      this.rings.forEach(r=>{
        if(!r.implemented) return;
        r._centre=this.ringCentre(r,ctx.time);
        const dist=r._centre.distanceTo(ctx.originPos);
        let mesh=S.meshes[r.id];
        if(dist>r.visualRange){ if(mesh) mesh.visible=false; return; }
        if(!mesh){ mesh=R.build(THREE,r); S.meshes[r.id]=mesh; S.group.add(mesh); }
        mesh.visible=true;
        R.update(THREE,r,mesh,ctx);
      });
    });

    S.started=true;
    const impl=this.rings.filter(r=>r.implemented).length;
    console.log("[Halo] "+MANIFEST.name+" v"+MANIFEST.version+" by "+MANIFEST.author+
      " — "+this.rings.length+" rings registered, "+impl+" implemented.");
    return this;
  },

  shutdown(){
    const S=this.state, R=global.HaloRenderer;
    Object.keys(S.meshes).forEach(k=>R.dispose(S.meshes[k]));
    S.meshes={};
    if(S.group&&S.group.parent) S.group.parent.remove(S.group);
    S.group=null;
    if(S.ext){
      const gi=S.ext.gravityProviders.indexOf(S.gravityFn);
      if(gi>=0) S.ext.gravityProviders.splice(gi,1);
      const fi=S.ext.frameHooks.indexOf(S.frameFn);
      if(fi>=0) S.ext.frameHooks.splice(fi,1);
      S.ext.megastructures=S.ext.megastructures.filter(m=>m.mod!==MANIFEST.id);
    }
    S.started=false;
    console.log("[Halo] mod shut down; HSP left untouched.");
  },

  /* ---- diagnostics ------------------------------------------------ */
  probe(pos,t){
    const S=this.state, P=global.HaloPhysics;
    return this.rings.filter(r=>r.implemented).map(r=>{
      r._centre=this.ringCentre(r,t||0);
      const L=P.local(S.THREE,r,pos);
      const g=P.gravity(S.THREE,r,pos);
      return {id:r.id,depth:L.depth,axial:L.axial,insideBand:L.insideBand,
              gravity:g?g.length():0};
    });
  },
  teleportToRing(id){
    const r=this.ringById(id||"KRI-01");
    if(!r||!global.flightState) return false;
    const c=this.ringCentre(r,global.flightState.time);
    /* 40 km above the floor, inside the band, already moving with the floor */
    global.flightState.position.copy(c).add(new this.state.THREE.Vector3(r.radius-40000,0,0));
    global.flightState.velocity.set(0,0,r.floorSpeed*0);
    console.log("[Halo] placed 40 km above the "+r.id+" floor.");
    return true;
  }
};

/* inline copy of data/rings.json so the mod runs from file:// without fetch */
HaloRingMod.DEFAULT_DATA={
  defaults:{radius:5.0e6,width:3.2e5,thickness:1.4e4,wallHeight:9.0e4,
            targetGravity:9.2,atmosphereHeight:2.6e4,
            activationRange:1.4e6,visualRange:8.0e7,theme:"verdant"},
  rings:[{id:"KRI-01",displayName:"KRI-01 — Verdant Halo",implemented:true,
          radius:5.0e6,width:3.2e5,targetGravity:9.2,terrainSeed:1101,theme:"verdant",
          orbit:{parent:"kerfin",a:2.4e7,phase:0.4,inc:0.22},
          blurb:"The first Kerfin Ring Installation. Nobody agrees on who built it, "+
                "and the surveys keep coming back with different numbers."}],
  generated:{count:25,startIndex:2,radiusBase:3.6e6,radiusStep:2.0e5,
             themes:["verdant","desert","frozen","oceanic","ashen","storm"]}
};

global.HaloRingMod=HaloRingMod;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloRingMod;
})(typeof window!=="undefined"?window:globalThis);
