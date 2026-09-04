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
  version:"0.5.0",
  author:"benjeep10",
  requires:{extApi:1}
};

const RING_DEFAULTS={
  radius:8.0e6, width:5.0e5, thickness:1.8e4, wallHeight:1.2e5,
  relief:6000, terrainEnabled:true,
  targetGravity:9.2, atmosphereHeight:2.6e4,
  /* FAR-FIELD gameplay attractor: lets HSP draw real orbits around the
     structure.  Deliberately separate from the spin values below, and range
     limited so it cannot perturb Kerfin, The Mon or anything else. */
  orbitMu:4.0e13, orbitRangeFactor:2.2,
  /* ring-local rotating physics reaches this far above the floor */
  localRange:1.4e6,
  visualRange:8.0e7,
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
    /* far-field reach scales with the structure, and is checked against the
       parent system below so it can never perturb a real body */
    r.orbitRange=r.orbitRange||r.radius*(r.orbitRangeFactor||2.2);
    r.spin=P.spinFor(r.radius,r.targetGravity);      /* ω, rad/s          */
    r.floorSpeed=r.spin*r.radius;                     /* 6.78 km/s for KRI-01 */
    r._axis=new (global.THREE.Vector3)(0,1,0);
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
  init(EXT,ringData,baseUrl){
    const S=this.state;
    S.baseUrl=baseUrl||S.baseUrl||"";
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
      const FS=liveFlightState();
      const vel=FS?FS.velocity:null;
      for(let i=0;i<this.rings.length;i++){
        const r=this.rings[i];
        if(!r.implemented) continue;
        r._centre=this.ringCentre(r,t);
        r._centreVel=this.ringVelocity(r,t);
        const a=P.acceleration(THREE,r,pos,vel);
        if(a){
          const L=P.frame(THREE,r,pos);
          S.active=r.id;
          S.telemetry={
            ring:r, L:L,
            mode:P.mode(r,L,this.halfHeight()),
            blend:P.localBlend(r,L),
            surfaceSpeed:P.surfaceVelocity(THREE,r,pos).length(),
            accel:a.length()
          };
          return a;
        }
      }
      S.active=null; S.telemetry=null;
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

    /* local floor patch under the vessel: two LOD windows, wide and near */
    S.floorFn=EXT.registerFrameHook(ctx=>{
      const THREE=S.THREE, P=global.HaloPhysics, R=global.HaloRenderer;
      const FS=liveFlightState(); if(!FS||!ctx.scene) return;
      for(let i=0;i<this.rings.length;i++){
        const r=this.rings[i];
        if(!r.implemented) continue;
        r._centre=this.ringCentre(r,ctx.time);
        r._centreVel=this.ringVelocity(r,ctx.time);
        const L=P.frame(THREE,r,FS.position);
        const near=L.insideBand&&L.floorAlt>-5e4&&L.floorAlt<r.localRange;
        if(!near){
          if(S.floorFar) S.floorFar.visible=false;
          if(S.floorNear) S.floorNear.visible=false;
          continue;
        }
        if(!S.floorGroup){
          S.floorGroup=new THREE.Group(); S.floorGroup.name="haloFloor";
          ctx.scene.add(S.floorGroup);
        }
        if(!S.floorFar){
          S.floorFar=R.buildFloorPatch(THREE,r,120,26);
          S.floorNear=R.buildFloorPatch(THREE,r,96,20);
          S.floorGroup.add(S.floorFar); S.floorGroup.add(S.floorNear);
        }
        /* the window scales with height so the horizon always looks right */
        const alt=Math.max(200,L.floorAlt);
        const wideAng=Math.min(0.55,Math.max(0.02,alt*14/r.radius));
        const nearAng=wideAng*0.22;
        R.updateFloorPatch(THREE,r,S.floorFar,L,FS.position,wideAng,
          Math.min(r.width*0.95,alt*70));
        R.updateFloorPatch(THREE,r,S.floorNear,L,FS.position,nearAng,
          Math.min(r.width*0.5,alt*16));
        S.floorFar.visible=true; S.floorNear.visible=true;
        S.floorNear.renderOrder=2;
      }
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

    /* heightmap lives beside the mod in the repo; missing file falls back to
       deterministic procedural relief rather than a flat floor */
    if(global.HaloTerrain){
      this.rings.filter(r=>r.implemented).forEach(r=>{
        global.HaloTerrain.load(r,(S.baseUrl||"")+"data/"+r.id+"-heightmap.png");
      });
    }
    this.installCollision();
    S.started=true;
    const impl=this.rings.filter(r=>r.implemented).length;
    console.log("[Halo] "+MANIFEST.name+" v"+MANIFEST.version+" by "+MANIFEST.author+
      " — "+this.rings.length+" rings registered, "+impl+" implemented.");
    return this;
  },

  halfHeight(){
    const v=lexical("vesselHalfHeight");
    return (typeof v==="number"&&v>0)?v:2;
  },

  /* Analytic collision against the inner floor.  No giant mesh: the ring is
     31,000 km around, so contact is solved from ring geometry and only local
     terrain chunks (later) will add detail. */
  installCollision(){
    const S=this.state, self=this;
    if(S.collisionInstalled) return;
    const base=global.handleSurface;
    const wrapped=function(dt){
      const FS=liveFlightState();
      const THREE=S.THREE, P=global.HaloPhysics;
      if(FS&&!FS.crashed){
        for(let i=0;i<self.rings.length;i++){
          const r=self.rings[i];
          if(!r.implemented) continue;
          r._centre=self.ringCentre(r,FS.time);
          r._centreVel=self.ringVelocity(r,FS.time);
          const c=P.floorContact(THREE,r,FS.position,FS.velocity,self.halfHeight());
          if(!c) continue;
          /* sit on the floor and move WITH it, so a parked craft does not
             slide at 6.78 km/s */
          FS.position.copy(c.position);
          const tangential=c.relVel.clone()
            .addScaledVector(c.L.radialDir,-c.relVel.dot(c.L.radialDir));
          const damped=tangential.multiplyScalar(0.72);
          FS.velocity.copy(c.surfaceVelocity).add(damped);
          FS.landed=damped.length()<1.5;
          S.lastContact={impact:c.impactSpeed,ring:r.id};
          if(c.impactSpeed>18&&!lexical("invincible")){
            FS.crashed=true;
            if(global.note) global.note("Impact with the "+r.id+" floor at "+
              c.impactSpeed.toFixed(0)+" m/s.");
          }
          return true;                 /* ring contact resolved this step */
        }
      }
      return (typeof base==="function")?base.apply(this,arguments):false;
    };
    wrapped.__halo=true; wrapped.__base=base;
    global.handleSurface=wrapped;
    S.collisionInstalled=true;
    console.log("[Halo] analytic ring-floor collision installed.");
  },

  removeCollision(){
    if(global.handleSurface&&global.handleSurface.__halo)
      global.handleSurface=global.handleSurface.__base;
    this.state.collisionInstalled=false;
  },

  shutdown(){
    const S=this.state, R=global.HaloRenderer;
    this.removeCheatEntries();
    this.removeCollision();
    if(S.floorGroup&&S.floorGroup.parent) S.floorGroup.parent.remove(S.floorGroup);
    S.floorGroup=null; S.floorFar=null; S.floorNear=null;
    if(S.ext&&S.floorFn){ const i=S.ext.frameHooks.indexOf(S.floorFn); if(i>=0) S.ext.frameHooks.splice(i,1); }
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

  /* 1. RING-CENTRE ORBIT — a genuine Kepler orbit using the far-field model,
     placed clear of the structure.  This is a real orbit. */
  orbitRing(id,altKm){
    const r=this.ringById(id||"KRI-01"); if(!r) return false;
    const FS=liveFlightState(); if(!FS){ console.warn("[Halo] not in flight"); return false; }
    const THREE=this.state.THREE, P=global.HaloPhysics;
    const t=FS.time;
    r._centre=this.ringCentre(r,t);
    r._centreVel=this.ringVelocity(r,t);
    /* default well outside the ring so the trajectory cannot clip the band */
    const radius=Math.max(r.radius*1.6,r.radius+(altKm===undefined?3000:altKm)*1000);
    const o=P.orbitState(THREE,r,radius);
    /* place over the axis pole side so the orbit plane misses the band */
    const dir=new THREE.Vector3(1,0,0);
    const tangent=new THREE.Vector3().crossVectors(r._axis,dir).normalize();
    FS.position.copy(r._centre).addScaledVector(dir,o.radius);
    FS.velocity.copy(this.ringVelocity(r,t)).addScaledVector(tangent,o.speed);
    FS.crashed=false; FS.landed=false;
    console.log("[Halo] ring-centre orbit: r="+(o.radius/1000).toFixed(0)+
      " km, v="+(o.speed/1000).toFixed(2)+" km/s, period "+(o.period/3600).toFixed(2)+" h");
    return true;
  },

  /* 2. RING-SURFACE INSERTION — NOT an orbit.  Places the vessel a given
     altitude above the interior floor, over the band centre, already moving
     with the rotating surface so it starts at rest relative to the terrain. */
  insertAboveFloor(id,altKm){
    const r=this.ringById(id||"KRI-01"); if(!r) return false;
    const FS=liveFlightState(); if(!FS){ console.warn("[Halo] not in flight"); return false; }
    const THREE=this.state.THREE, P=global.HaloPhysics;
    const t=FS.time;
    r._centre=this.ringCentre(r,t);
    r._centreVel=this.ringVelocity(r,t);
    const alt=(altKm===undefined?120:altKm)*1000;
    /* up on the inner surface points at the axis: radius = floorRadius - alt */
    const cylR=Math.max(1000,r.radius-alt);
    const dir=new THREE.Vector3(1,0,0);
    FS.position.copy(r._centre).addScaledVector(dir,cylR);   /* axial 0 = band centre */
    /* surfaceVelocity already includes the ring's translational motion */
    const surfV=P.surfaceVelocity(THREE,r,FS.position);
    FS.velocity.copy(surfV);
    FS.crashed=false; FS.landed=false;
    console.log("[Halo] inserted "+(alt/1000).toFixed(0)+" km above the "+r.id+
      " floor, matched to the floor at "+(P.spinVelocity(THREE,r,FS.position).length()/1000).toFixed(2)+" km/s");
    return true;
  },

  /* kept for compatibility; surface insertion is what people mean */
  teleportToRing(id,altKm){ return this.insertAboveFloor(id,altKm); },

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
          /* "Circular orbit" around a ring means a REAL orbit about its
             centre using the far-field model — not hovering above the floor. */
          const r=ringOf();
          const altEl=document.getElementById("hspBodyAlt");
          const alt=Number(altEl&&altEl.value)||3000;
          if(self.orbitRing(r.id,alt)&&global.note){
            const o=global.HaloPhysics.orbitState(self.state.THREE,r,
              Math.max(r.radius*1.6,r.radius+alt*1000));
            global.note("Ring-centre orbit of "+r.id+": "+(o.radius/1000).toFixed(0)+
              " km radius, "+(o.speed/1000).toFixed(2)+" km/s, period "+
              (o.period/3600).toFixed(1)+" h.");
          }
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
          /* "Land" on a ring = surface insertion just above the floor,
             already matched to the rotating terrain. */
          const r=ringOf();
          if(self.insertAboveFloor(r.id,0.4)&&global.note)
            global.note("On the "+r.id+" floor, matched to "+
              (r.floorSpeed/1000).toFixed(2)+" km/s surface motion.");
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
  defaults:{radius:8.0e6,width:5.0e5,thickness:1.8e4,wallHeight:1.2e5,relief:6000,
            targetGravity:9.2,atmosphereHeight:2.6e4,
            activationRange:1.4e6,visualRange:8.0e7,theme:"verdant"},
  rings:[{id:"KRI-01",displayName:"KRI-01 — Verdant Halo",implemented:true,
          radius:8.0e6,width:5.0e5,targetGravity:9.2,relief:6000,terrainSeed:1101,theme:"verdant",
          orbit:{parent:"kerfin",a:4.5e7,phase:0.4,inc:0.22},
          blurb:"The first Kerfin Ring Installation. Nobody agrees on who built it, "+
                "and the surveys keep coming back with different numbers."}],
  generated:{count:25,startIndex:2,radiusBase:3.6e6,radiusStep:2.0e5,
             themes:["verdant","desert","frozen","oceanic","ashen","storm"]}
};

global.HaloRingMod=HaloRingMod;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloRingMod;
})(typeof window!=="undefined"?window:globalThis);
