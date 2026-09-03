/* =====================================================================
   halo-ring-renderer.js — megastructure visuals
   Builds one open cylinder band per implemented ring and places it through
   HSP's floating origin.  Meshes are created lazily and hidden beyond the
   ring's visualRange, so unimplemented rings cost nothing.
   ===================================================================== */
(function(global){
"use strict";

const THEME_COLOUR={
  verdant:0x6f8f5a, desert:0xb08a54, frozen:0xa8c4d8,
  oceanic:0x4a7fa8, ashen:0x6a6a6a, storm:0x7a6f92
};

const HaloRenderer={
  build(THREE,ring){
    /* segment count scales with size but stays bounded: a 5000 km ring is
       still only a few hundred segments, which is nothing next to terrain */
    const seg=Math.max(64,Math.min(256,Math.round(ring.radius/40000)));
    const geo=new THREE.CylinderGeometry(ring.radius,ring.radius,ring.width,seg,1,true);
    const mat=new THREE.MeshStandardMaterial({
      color:THEME_COLOUR[ring.theme]||0x8a8a8a,
      roughness:0.92, metalness:0.05,
      side:THREE.BackSide            /* we live on the inner surface */
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.name="halo:"+ring.id;
    mesh.frustumCulled=false;
    return mesh;
  },

  update(THREE,ring,mesh,ctx){
    mesh.position.copy(ring._centre).sub(ctx.originPos);   /* floating origin */
    mesh.rotation.y=(ctx.time*ring.spin)%(Math.PI*2);
  },

  dispose(mesh){
    if(mesh.parent) mesh.parent.remove(mesh);
    if(mesh.geometry) mesh.geometry.dispose();
    if(mesh.material) mesh.material.dispose();
  }
};

global.HaloRenderer=HaloRenderer;
if(typeof module!=="undefined"&&module.exports) module.exports=HaloRenderer;
})(typeof window!=="undefined"?window:globalThis);
