/* =====================================================================
   halo-ring-physics.js — KRI ring geometry, gravity and collision
   Pure maths: no HSP references, no globals.  Everything is passed in.

   TWO SEPARATE MODELS, deliberately never mixed:

   1. FAR-FIELD ORBITAL (gameplay approximation)
      A spherical attractor at the ring's geometric centre with its own
      ring.orbitMu, active only inside ring.orbitRange and faded out at the
      edge so it perturbs nothing else in the system.  This exists purely so
      HSP can draw Kepler orbits and trajectories around the structure.

   2. ROTATING-RING LOCAL (real pseudo-forces)
      Centrifugal ω²r outward plus Coriolis -2ω×v_rel, expressed in the
      ring's rotating frame.  This is what produces the apparent 1 g on the
      inner floor.  It is NOT gravity and is never used as a far-field force.

   The two are cross-faded by geometry so neither ever jumps.
   ===================================================================== */
(function(global){
"use strict";
const _g=global;

const HaloPhysics={

  spinFor(radius,targetGravity){ return Math.sqrt(targetGravity/radius); },

  /* ---- ring-local coordinates -------------------------------------- */
  frame(THREE,ring,pos){
    const axis=ring._axis||new THREE.Vector3(0,1,0);
    const rel=pos.clone().sub(ring._centre);
    const axial=rel.dot(axis);
    const radialVec=rel.clone().sub(axis.clone().multiplyScalar(axial));
    const cylRadius=radialVec.length();
    const radialDir=cylRadius>1e-6?radialVec.clone().multiplyScalar(1/cylRadius)
                                  :new THREE.Vector3(1,0,0);
    const tangentDir=new THREE.Vector3().crossVectors(axis,radialDir).normalize();
    return {
      rel:rel, axis:axis, axial:axial,
      radialVec:radialVec, cylRadius:cylRadius,
      radialDir:radialDir, tangentDir:tangentDir,
      /* "up" on the inner surface points toward the axis, so floor altitude
         is floorRadius - cylindricalRadius, NOT distance-from-centre. */
      floorAlt:ring.radius-cylRadius,
      insideBand:Math.abs(axial)<=ring.width*0.5,
      bandEdge:Math.abs(axial)-ring.width*0.5
    };
  },

  /* Velocity of the rotating floor at this point, in the INERTIAL frame:
       ω × r   (spin)   +   the ring's own translational motion
     The second term matters enormously: KRI-01 is parented to Kerfin, which
     travels ~9.4 km/s through the Sun frame.  Omitting it made a parked
     vessel slip across the floor at exactly that speed. */
  surfaceVelocity(THREE,ring,pos){
    const L=this.frame(THREE,ring,pos);
    const omega=L.axis.clone().multiplyScalar(ring.spin);
    const spin=new THREE.Vector3().crossVectors(omega,L.radialVec);
    if(ring._centreVel) spin.add(ring._centreVel);
    return spin;
  },
  /* spin component alone, for reporting "surface speed" */
  spinVelocity(THREE,ring,pos){
    const L=this.frame(THREE,ring,pos);
    const omega=L.axis.clone().multiplyScalar(ring.spin);
    return new THREE.Vector3().crossVectors(omega,L.radialVec);
  },

  /* ---- which regime are we in -------------------------------------- */
  MODES:["DISTANT_ORBIT","APPROACH","RING_LOCAL","SURFACE"],
  mode(ring,L,halfHeight){
    const hh=halfHeight||2;
    if(L.insideBand&&L.floorAlt<=hh+2) return "SURFACE";
    if(L.insideBand&&L.floorAlt<ring.localRange) return "RING_LOCAL";
    if(L.cylRadius<ring.radius+ring.orbitRange&&Math.abs(L.axial)<ring.width*3) return "APPROACH";
    return "DISTANT_ORBIT";
  },

  /* 0 = pure far-field orbital, 1 = pure rotating-ring local.
     Depends on being inside the band AND close to the floor, so a craft
     passing outside the ring never picks up spin effects. */
  localBlend(ring,L){
    if(L.floorAlt<0) return 0;                       /* outside the shell   */
    const depth=1-Math.min(1,L.floorAlt/ring.localRange);
    const band=1-Math.min(1,Math.max(0,L.bandEdge)/(ring.width*0.5));
    const w=depth*band;
    return w*w*(3-2*w);                              /* smoothstep, C1      */
  },

  /* ---- 1. far-field orbital approximation --------------------------- */
  farFieldGravity(THREE,ring,pos){
    const d=ring._centre.clone().sub(pos);
    const r=d.length();
    if(r<1) return null;
    if(r>ring.orbitRange) return null;               /* affects nothing else */
    /* fade the last 20% of the range so entering it is not a step */
    const edge=Math.min(1,(ring.orbitRange-r)/(ring.orbitRange*0.2));
    const fade=edge*edge*(3-2*edge);
    const a=ring.orbitMu/(r*r);
    return d.multiplyScalar(a*fade/r);
  },

  /* ---- 2. rotating-frame pseudo-forces ------------------------------ */
  centrifugal(THREE,ring,L){
    /* a = ω² r, directed radially OUTWARD, i.e. toward the floor */
    return L.radialDir.clone().multiplyScalar(ring.spin*ring.spin*L.cylRadius);
  },
  coriolis(THREE,ring,L,relVel){
    /* a = -2 ω × v_rel */
    const omega=L.axis.clone().multiplyScalar(ring.spin);
    return new THREE.Vector3().crossVectors(omega,relVel).multiplyScalar(-2);
  },

  /* Total acceleration contributed by one ring, given inertial velocity.
     Returns null when the ring should contribute nothing at all. */
  acceleration(THREE,ring,pos,vel){
    if(!ring.implemented) return null;
    const L=this.frame(THREE,ring,pos);
    const w=this.localBlend(ring,L);
    const acc=new THREE.Vector3();
    let any=false;

    const far=this.farFieldGravity(THREE,ring,pos);
    if(far){ acc.addScaledVector(far,1-w); any=true; }

    if(w>0.001){
      acc.addScaledVector(this.centrifugal(THREE,ring,L),w);
      if(vel){
        const sv=this.surfaceVelocity(THREE,ring,pos);
        const relVel=vel.clone().sub(sv);
        acc.addScaledVector(this.coriolis(THREE,ring,L,relVel),w);
      }
      any=true;
    }
    return any?acc:null;
  },

  /* ---- collision with the inner floor ------------------------------- */
  /* Analytic, not a mesh: ring material exists outward of the inner surface.
     Detailed terrain collision is a separate, local-chunk problem. */
  floorContact(THREE,ring,pos,vel,halfHeight){
    if(!ring.implemented) return null;
    const hh=halfHeight||2;
    const L=this.frame(THREE,ring,pos);
    if(!L.insideBand) return null;
    /* terrain raises the floor toward the axis, so the contact radius is
       smaller than the datum radius wherever there are mountains */
    const T=_g.HaloTerrain;
    const floorR=(T&&ring.terrainEnabled!==false)?T.floorRadiusAt(ring,L):ring.radius;
    L.terrainFloorRadius=floorR;
    L.floorAlt=floorR-L.cylRadius;                   /* above the TERRAIN   */
    const clearance=L.floorAlt-hh;                   /* >0 = clear of floor */
    if(clearance>0) return null;
    const sv=this.surfaceVelocity(THREE,ring,pos);
    const relVel=vel?vel.clone().sub(sv):new THREE.Vector3();
    const outward=relVel.dot(L.radialDir);           /* >0 = into the floor */
    return {
      L:L,
      clearance:clearance,
      /* position that sits exactly on the floor */
      position:ring._centre.clone()
        .add(L.axis.clone().multiplyScalar(L.axial))
        .add(L.radialDir.clone().multiplyScalar((L.terrainFloorRadius||ring.radius)-hh)),
      surfaceVelocity:sv,
      relVel:relVel,
      impactSpeed:Math.max(0,outward),
      /* "down" is outward; the normal pointing into the habitable interior */
      up:L.radialDir.clone().negate(),
      down:L.radialDir.clone()
    };
  },

  /* Circular orbit about the ring centre using the far-field model only. */
  orbitState(THREE,ring,radius){
    const r=Math.max(radius,ring.radius*1.15);
    return {radius:r, speed:Math.sqrt(ring.orbitMu/r),
            period:2*Math.PI*Math.sqrt(r*r*r/ring.orbitMu)};
  }
};

global.HaloPhysics=HaloPhysics;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloPhysics;
})(typeof window!=="undefined"?window:globalThis);
