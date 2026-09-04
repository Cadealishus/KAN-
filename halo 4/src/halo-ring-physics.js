/* =====================================================================
   halo-ring-physics.js — ring geometry and artificial gravity
   Pure maths. No HSP references, no THREE globals: everything is passed in.
   ===================================================================== */
(function(global){
"use strict";

const HaloPhysics={
  /* spin rate that yields the requested floor gravity:  a = w^2 * r  */
  spinFor(radius,targetGravity){ return Math.sqrt(targetGravity/radius); },

  /* Decompose a world point into the ring's cylindrical frame. */
  local(THREE,ring,pos){
    const centre=ring._centre, axis=ring._axis||new THREE.Vector3(0,1,0);
    const d=pos.clone().sub(centre);
    const axial=d.dot(axis);
    const radialVec=d.clone().sub(axis.clone().multiplyScalar(axial));
    const radial=radialVec.length();
    const outward=radial>1e-6?radialVec.multiplyScalar(1/radial):new THREE.Vector3(1,0,0);
    return {
      axial:axial, radial:radial, outward:outward,
      depth:ring.radius-radial,                      /* >0 = inside the shell */
      insideBand:Math.abs(axial)<=ring.width*0.5
    };
  },

  /* Artificial gravity.
     Real centrifugal force only acts on something already co-rotating; a
     craft arriving from outside is not, so applying full w^2 r at the
     boundary would fling it sideways.  The pull is therefore ramped in with
     a smoothstep on depth and aimed strictly OUTWARD along the radial, which
     gives a stable "down" without ever injecting tangential energy.
     Returns null when inactive so the host sees an untouched gravity sum. */
  gravity(THREE,ring,pos){
    if(!ring.implemented) return null;
    const L=this.local(THREE,ring,pos);
    if(!L.insideBand) return null;
    if(L.depth<0||L.depth>ring.activationRange) return null;
    const h=L.depth/ring.activationRange;
    const fade=1-Math.max(0,Math.min(1,h));
    const smooth=fade*fade*(3-2*fade);              /* C1 continuous */
    const g=ring.targetGravity*smooth;
    if(g<1e-4) return null;
    return L.outward.multiplyScalar(g);
  },

  /* Surface query for a future landing implementation: how far above the
     floor, and which way is up.  Not registered yet — see README. */
  surface(THREE,ring,pos){
    const L=this.local(THREE,ring,pos);
    if(!L.insideBand||L.depth<0) return null;
    return {clearance:L.depth, up:L.outward.clone().negate(), radial:L.radial};
  }
};

global.HaloPhysics=HaloPhysics;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloPhysics;
})(typeof window!=="undefined"?window:globalThis);
