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
  version:"0.3.0",
  author:"benjeep10",
  requires:{extApi:1}
};

const RING_DEFAULTS={
  radius:5.0e6, width:3.2e5, thickness:1.4e4, wallHeight:9.0e4,
  targetGravity:9.2, atmosphereHeight:2.6e4,
  activationRange:1.4e6, visualRange:8.0e7,
  terrainSeed:1, theme:"verdant", implemented:false
};


/* HSP declares `flightState` with `let` at top level.  A top-level let lands in
   the global LEXICAL environment, not on `window`, so `global.flightState` is
   undefined even though the name resolves fine as a bare identifier.  Reading
   it the wrong way made teleportToRing() return false and the cheat button do
   nothing at all.  Resolve it both ways. */
function lexical(name){
  try{ return (0,eval)("typeof "+name+"!=='undefined' ? "+name+" : undefined"); }
  catch(e){ return undefined; }
}
function liveFlightState(){
  return lexical("flightState")||global.flightState||null;
}

const HaloRingMod={
  manifest:MANIFEST,
  rings:[],
  state:{ext:null,THREE:null,group:null,meshes:{},mapGroup:null,mapMarkers:{},active:null,started:false},

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

    /* System-map marker.  HSP's map does not read HSP_EXT.megastructures, so
       the mod draws into the map scene itself.  mapScene is a top-level `let`,
       i.e. a lexical global rather than a window property — hence lexical(). */
    S.mapFn=EXT.registerFrameHook(()=>{
      const THREE=S.THREE, R=global.HaloRenderer;
      const mapScene=lexical("mapScene");
      const FS=liveFlightState();
      if(!mapScene||!FS) return;
      if(!S.mapGroup){
        S.mapGroup=new THREE.Group(); S.mapGroup.name="haloRingsMap";
        mapScene.add(S.mapGroup);
      }
      this.rings.forEach(r=>{
        if(!r.implemented) return;
        let mk=S.mapMarkers[r.id];
        if(!mk){ mk=R.buildMapMarker(THREE,r); S.mapMarkers[r.id]=mk; S.mapGroup.add(mk); }
        mk.position.copy(this.ringCentre(r,FS.time)).sub(FS.position);
        mk.visible=true;
      });
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

    /* the cheats panel is built lazily, so keep trying for a while */
    let tries=0;
    const poll=()=>{
      if(this.installCheatEntries()) return;
      if(tries++<120) setTimeout(poll,500);
    };
    poll();

    S.started=true;
    const impl=this.rings.filter(r=>r.implemented).length;
    console.log("[Halo] "+MANIFEST.name+" v"+MANIFEST.version+" by "+MANIFEST.author+
      " — "+this.rings.length+" rings registered, "+impl+" implemented.");
    return this;
  },

  shutdown(){
    const S=this.state, R=global.HaloRenderer;
    this.removeCheatEntries();
    Object.keys(S.mapMarkers).forEach(k=>R.dispose(S.mapMarkers[k]));
    S.mapMarkers={};
    if(S.mapGroup&&S.mapGroup.parent) S.mapGroup.parent.remove(S.mapGroup);
    S.mapGroup=null;
    if(S.ext&&S.mapFn){ const i=S.ext.frameHooks.indexOf(S.mapFn); if(i>=0) S.ext.frameHooks.splice(i,1); }
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
  /* Arrive already moving with the ring, not with the Sun.  The ring is
     parented to Kerfin, which travels ~9.4 km/s through the Sun frame, so
     zeroing velocity outright would fling the craft across the band. */
  ringVelocity(ring,t){
    const THREE=this.state.THREE;
    const v=new THREE.Vector3();
    if(global.hspBodyVel&&ring.orbit&&ring.orbit.parent){
      try{ v.copy(global.hspBodyVel(ring.orbit.parent,t)); }catch(e){}
    }
    return v;
  },

  teleportToRing(id,altKm){
    const r=this.ringById(id||"KRI-01");
    if(!r){ console.warn("[Halo] no such ring: "+id); return false; }
    const FS=liveFlightState();
    if(!FS){ console.warn("[Halo] not in flight"); return false; }
    const THREE=this.state.THREE;
    const t=FS.time;
    const c=this.ringCentre(r,t);
    const alt=(altKm===undefined?40:altKm)*1000;
    /* place inside the band, that far above the floor, on the +X radial */
    FS.position.copy(c).add(new THREE.Vector3(r.radius-alt,0,0));
    FS.velocity.copy(this.ringVelocity(r,t));
    FS.crashed=false;
    FS.landed=false;
    console.log("[Halo] placed "+(alt/1000)+" km above the "+r.id+" floor.");
    return true;
  },

  /* Add the implemented rings to HSP's own teleport dropdown.  Done by
     wrapping the two cheat helpers rather than editing HSP: ring ids are
     namespaced "halo:KRI-01" so nothing collides with a real body. */
  installCheatEntries(){
    const S=this.state;
    if(S.cheatsInstalled) return;
    const sel=document.getElementById("hspBodySel");
    if(!sel) return false;
    this.rings.filter(r=>r.implemented).forEach(r=>{
      if(sel.querySelector('option[value="halo:'+r.id+'"]')) return;
      const o=document.createElement("option");
      o.value="halo:"+r.id;
      o.textContent="◍ "+(r.displayName||r.id)+"  (ring)";
      sel.appendChild(o);
    });
    const self=this;
    if(global.hspOrbitBody&&!global.hspOrbitBody.__halo){
      const baseOrbit=global.hspOrbitBody;
      const wrapped=function(id,altKm){
        if(typeof id==="string"&&id.indexOf("halo:")===0)
          return self.teleportToRing(id.slice(5),altKm);
        return baseOrbit.apply(this,arguments);
      };
      wrapped.__halo=true; wrapped.__base=baseOrbit;
      global.hspOrbitBody=wrapped;
    }
    if(global.hspLandBody&&!global.hspLandBody.__halo){
      const baseLand=global.hspLandBody;
      const wrapped=function(id){
        if(typeof id==="string"&&id.indexOf("halo:")===0)
          return self.teleportToRing(id.slice(5),0.5);
        return baseLand.apply(this,arguments);
      };
      wrapped.__halo=true; wrapped.__base=baseLand;
      global.hspLandBody=wrapped;
    }

    /* HSP's cheat panel indexes HSP_BODIES[sel.value] directly — for the
       description text and again in the button handlers' success message.  A
       ring is deliberately NOT a body, so those lookups return undefined and
       throw ("Cannot read properties of undefined (reading 'mu')").  The mod
       therefore takes full responsibility for its own ids: the handlers below
       intercept halo: values and never let them reach the core lookups. */
    const isHalo=()=>sel.value.indexOf("halo:")===0;
    const ringOf=()=>self.ringById(sel.value.slice(5));

    const desc=document.getElementById("hspBodyDesc");
    const priorChange=sel.onchange;
    sel.onchange=function(){
      if(isHalo()){
        const r=ringOf();
        if(desc&&r){
          desc.innerHTML="<b>"+(r.displayName||r.id)+"</b> — ringworld, "+
            (r.radius/1000).toFixed(0)+" km radius, "+(r.width/1000).toFixed(0)+
            " km band, "+r.targetGravity.toFixed(2)+" m/s² at the floor (spin), "+
            (r.floorSpeed/1000).toFixed(2)+" km/s floor speed<br>"+(r.blurb||"");
        }
        return;
      }
      if(typeof priorChange==="function") return priorChange.apply(this,arguments);
    };

    const orbitBtn=document.getElementById("hspGoOrbit");
    if(orbitBtn&&!orbitBtn.__halo){
      const prior=orbitBtn.onclick;
      orbitBtn.onclick=function(){
        if(isHalo()){
          const r=ringOf();
          const altEl=document.getElementById("hspBodyAlt");
          const alt=Number(altEl&&altEl.value)||40;
          if(self.teleportToRing(r.id,alt)&&global.note)
            global.note("Holding "+alt+" km above the "+r.id+" floor.");
          return;
        }
        if(typeof prior==="function") return prior.apply(this,arguments);
      };
      orbitBtn.__halo=true; orbitBtn.__priorClick=prior;
    }
    const landBtn=document.getElementById("hspGoLand");
    if(landBtn&&!landBtn.__halo){
      const prior=landBtn.onclick;
      landBtn.onclick=function(){
        if(isHalo()){
          const r=ringOf();
          if(self.teleportToRing(r.id,0.5)&&global.note)
            global.note("Set down on the "+r.id+" floor.");
          return;
        }
        if(typeof prior==="function") return prior.apply(this,arguments);
      };
      landBtn.__halo=true; landBtn.__priorClick=prior;
    }

    S.cheatsInstalled=true;
    console.log("[Halo] ring destinations added to the flight cheats dropdown.");
    return true;
  },

  removeCheatEntries(){
    const sel=document.getElementById("hspBodySel");
    if(sel){
      Array.from(sel.querySelectorAll('option[value^="halo:"]')).forEach(o=>o.remove());
      if(sel.value&&sel.value.indexOf("halo:")===0){ sel.selectedIndex=0; if(sel.onchange) sel.onchange(); }
    }
    ["hspGoOrbit","hspGoLand"].forEach(bid=>{
      const b=document.getElementById(bid);
      if(b&&b.__halo){ b.onclick=b.__priorClick||null; b.__halo=false; }
    });
    if(global.hspOrbitBody&&global.hspOrbitBody.__base) global.hspOrbitBody=global.hspOrbitBody.__base;
    if(global.hspLandBody&&global.hspLandBody.__base) global.hspLandBody=global.hspLandBody.__base;
    this.state.cheatsInstalled=false;
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
