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

  /* A displaced floor patch under the vessel.  The full ring is 50,000 km
     around, so only a local window of the cylinder is ever built — the same
     idea as HSP's terrain caps, in ring coordinates. */
  buildFloorPatch(THREE,ring,segU,segV){
    const su=segU||96, sv=segV||24;
    const geo=new THREE.PlaneGeometry(1,1,su,sv);
    const mat=new THREE.MeshStandardMaterial({
      vertexColors:true, roughness:0.95, metalness:0.02, side:THREE.DoubleSide
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.name="haloFloor:"+ring.id;
    mesh.frustumCulled=false;
    mesh.userData.segU=su; mesh.userData.segV=sv;
    return mesh;
  },

  /* Rebuild the patch around a ring-local (u,v) centre.  spanU is in radians
     of ring angle, spanV in metres across the band. */
  updateFloorPatch(THREE,ring,mesh,L,originPos,spanAng,spanV){
    const T=global.HaloTerrain;
    const su=mesh.userData.segU, sv=mesh.userData.segV;
    const pos=mesh.geometry.attributes.position;
    let colAttr=mesh.geometry.attributes.color;
    if(!colAttr){
      colAttr=new THREE.BufferAttribute(new Float32Array(pos.count*3),3);
      mesh.geometry.setAttribute("color",colAttr);
    }
    const axis=L.axis;
    let ref=ring._ref;
    if(!ref){
      ref=Math.abs(axis.y)>0.9?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0);
      ref=new THREE.Vector3().crossVectors(axis,ref).normalize();
      ring._ref=ref;
    }
    const bi=new THREE.Vector3().crossVectors(axis,ref).normalize();
    const q=T?T.uv(ring,L):{u:0,v:0.5};
    const angC=q.u*Math.PI*2, axC=L.axial;
    const c=new THREE.Color();
    const p=new THREE.Vector3();
    for(let j=0;j<=sv;j++){
      const fv=j/sv;
      const ax=axC+(fv-0.5)*spanV;
      for(let i=0;i<=su;i++){
        const fu=i/su;
        const ang=angC+(fu-0.5)*spanAng;
        let u=(ang/(Math.PI*2))%1; if(u<0) u+=1;
        const v=(ax+ring.width*0.5)/ring.width;
        const h=T?T.heightAt(ring,u,Math.max(0,Math.min(1,v))):0;
        const rr=ring.radius-h;                       /* terrain rises inward */
        const dir=ref.clone().multiplyScalar(Math.cos(ang))
                 .add(bi.clone().multiplyScalar(Math.sin(ang)));
        p.copy(ring._centre)
         .add(axis.clone().multiplyScalar(ax))
         .add(dir.multiplyScalar(rr))
         .sub(originPos);
        const idx=j*(su+1)+i;
        pos.setXYZ(idx,p.x,p.y,p.z);
        /* height + band position drive the colour: lowlands green, uplands
           rock, ridges pale, edges of the band frozen */
        const t=Math.max(0,Math.min(1,h/(ring.relief||6000)));
        const edge=Math.min(v,1-v);
        if(edge<0.10) c.setRGB(0.80,0.85,0.90);              /* rim ice      */
        else if(t<0.28) c.setRGB(0.20+0.10*t,0.42+0.18*t,0.18+0.10*t);
        else if(t<0.62) c.setRGB(0.34+0.18*t,0.40+0.10*t,0.24);
        else if(t<0.85) c.setRGB(0.44,0.41,0.37);
        else c.setRGB(0.86,0.88,0.92);                       /* peaks        */
        colAttr.setXYZ(idx,c.r,c.g,c.b);
      }
    }
    pos.needsUpdate=true; colAttr.needsUpdate=true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  },

  update(THREE,ring,mesh,ctx){
    mesh.position.copy(ring._centre).sub(ctx.originPos);   /* floating origin */
    mesh.rotation.y=(ctx.time*ring.spin)%(Math.PI*2);
  },

  /* A cheap wireframe ring for the system map.  HSP's map places objects at
     (absolute - flightState.position), the same floating-origin convention the
     flight scene uses, so the same maths works for both. */
  buildMapMarker(THREE,ring){
    const geo=new THREE.TorusGeometry(ring.radius,Math.max(ring.width*0.35,ring.radius*0.01),8,96);
    const mat=new THREE.MeshBasicMaterial({
      color:THEME_COLOUR[ring.theme]||0x8a8a8a, wireframe:true,
      transparent:true, opacity:0.85, depthTest:false
    });
    const mesh=new THREE.Mesh(geo,mat);
    mesh.name="haloMap:"+ring.id;
    mesh.rotation.x=Math.PI/2;      /* torus lies in the ring's plane */
    mesh.renderOrder=999;
    mesh.frustumCulled=false;
    return mesh;
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
